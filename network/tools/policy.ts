// Compiles declared intent (landscape.yaml plus every application's architecture.yaml) into
// a list of allowed flows. Everything not in the list is denied. A flow exists only when
// BOTH sides declare it: the consumer in `consumes`, the provider in `provides.consumers`.

import type { Consume, Model, Provide, Service } from '../../enterprise-architecture/tools/lib/model.ts';
import { within } from '../../enterprise-architecture/tools/lib/net.ts';

export interface Endpoint {
  kind: 'service' | 'zone';
  id: string;
  addresses: string[]; // IPs for services, CIDRs for zones
}

export interface Flow {
  from: Endpoint;
  to: Endpoint;
  port: number;
  purpose: string;
  declaredIn: string;
}

export interface EgressRule {
  service: string;
  sources: string[];
  fqdn: string;
  port: number;
}

export interface Problem {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  fix: string;
}

export interface Policy {
  flows: Flow[];
  egress: EgressRule[];
  problems: Problem[];
}

const EGRESS_PROXY = 'egress-proxy';

export function compilePolicy(model: Model): Policy {
  const { landscape, services } = model;
  const flows: Flow[] = [];
  const egress: EgressRule[] = [];
  const problems: Problem[] = [];
  const backendsDone = new Set<string>();

  const svc = (id: string) => services.get(id);
  const sources = (s: Service): Endpoint => ({ kind: 'service', id: s.id, addresses: (s.egress ?? s.instances).map((i) => i.address) });
  const destinations = (s: Service): Endpoint => ({ kind: 'service', id: s.id, addresses: (s.vips ?? s.instances).map((i) => i.address) });
  const instancesOf = (s: Service): Endpoint => ({ kind: 'service', id: s.id, addresses: s.instances.map((i) => i.address) });
  const zone = (id: string): Endpoint | undefined => {
    const z = landscape.zones[id];
    return z ? { kind: 'zone', id, addresses: z.cidrs } : undefined;
  };

  /** The load balancer's own flows to the provider's instances, once per interface. */
  const addBackend = (provider: Service, p: Provide, lb: Service) => {
    const key = `${provider.id}/${p.name}`;
    if (backendsDone.has(key)) return;
    backendsDone.add(key);
    const purpose = `${lb.id} forwards to ${provider.id} ${p.name}`;
    flows.push({ from: sources(lb), to: instancesOf(provider), port: p.port, purpose, declaredIn: provider.source });
    if (p.health && p.health.port !== p.port) {
      flows.push({ from: sources(lb), to: instancesOf(provider), port: p.health.port, purpose: `${lb.id} checks ${provider.id} ${p.health.path}`, declaredIn: provider.source });
    }
  };

  /** A flow from `from` to provider interface `p`, through its load balancer if it has one. */
  const addFlowTo = (from: Endpoint, provider: Service, p: Provide, purpose: string, declaredIn: string) => {
    if (p.via) {
      const lb = svc(p.via);
      if (!lb) {
        problems.push({ severity: 'error', rule: 'SEC-02', message: `${provider.id} ${p.name} is published via unknown load balancer ${p.via}.`, fix: 'Use edge-adc or platform-lb.' });
        return;
      }
      flows.push({ from, to: destinations(lb), port: p['frontend-port'] ?? p.port, purpose, declaredIn });
      addBackend(provider, p, lb);
    } else {
      // Self-consumption (replication, consensus): instances talk to each other.
      flows.push({ from, to: destinations(provider), port: p.port, purpose, declaredIn });
    }
  };

  const authorizes = (provider: Service, p: Provide, consumer: Service, c: Consume): boolean => {
    const list = p.consumers;
    if (list === 'all-production') return true;
    if (list === 'database-owners') return !!provider.databases?.some((d) => d.name === c.database && d.owner === consumer.id);
    if (list === 'declared-externals') return !!consumer.consumes?.some((x) => x.external);
    return list.includes(consumer.id);
  };

  // 1. Service-to-service and service-to-external, from each consumer's declarations.
  for (const consumer of services.values()) {
    for (const c of consumer.consumes ?? []) {
      if (c.external) {
        const ext = landscape.externals[c.external];
        const proxy = svc(EGRESS_PROXY);
        if (!ext) {
          problems.push({ severity: 'error', rule: 'INT-05', message: `${consumer.id} consumes unknown external ${c.external}.`, fix: 'Ask Central IT to register the external in landscape.yaml.' });
        } else if (ext.consumers !== 'any' && !ext.consumers.includes(consumer.id)) {
          problems.push({ severity: 'error', rule: 'INT-05', message: `${consumer.id} may not reach ${c.external}; only ${ext.consumers.join(', ')} may.`, fix: `Use the shared service that owns ${c.external} (INT-05).` });
        } else if (proxy) {
          const proxyApi = proxy.provides?.[0];
          if (proxyApi) flows.push({ from: sources(consumer), to: destinations(proxy), port: proxyApi.port, purpose: `${consumer.id} to ${c.external} through the egress proxy`, declaredIn: consumer.source });
          egress.push({ service: consumer.id, sources: sources(consumer).addresses, fqdn: ext.fqdn, port: ext.port });
        }
        continue;
      }
      const provider = c.service ? svc(c.service) : undefined;
      if (!provider) {
        problems.push({ severity: 'error', rule: 'INT-01', message: `${consumer.id} consumes unknown service ${c.service ?? '(none)'}.`, fix: 'Consume a service that exists in the landscape.' });
        continue;
      }
      const candidates = provider.provides ?? [];
      const p = c.interface ? candidates.find((x) => x.name === c.interface) : candidates.length === 1 ? candidates[0] : undefined;
      if (!p) {
        problems.push({
          severity: 'error', rule: 'INT-03',
          message: `${consumer.id} consumes ${provider.id}${c.interface ? ` interface "${c.interface}"` : ''}, which ${c.interface ? 'does not exist' : 'is ambiguous'}.`,
          fix: `Name one of ${provider.id}'s interfaces: ${candidates.map((x) => x.name).join(', ') || '(none)'}.`,
        });
        continue;
      }
      if (!authorizes(provider, p, consumer, c)) {
        const how = p.consumers === 'database-owners'
          ? `Central IT provisions database "${c.database ?? '?'}" on ${provider.id} with owner ${consumer.id} in landscape.yaml.`
          : `${provider.id}'s owner (${provider.owner}) adds ${consumer.id} to the consumers of "${p.name}" in ${provider.source}.`;
        problems.push({ severity: 'error', rule: 'SEC-02', message: `${consumer.id} wants ${provider.id} "${p.name}", but ${provider.id} does not accept it as a consumer.`, fix: how });
        continue;
      }
      const from = sources(consumer);
      if (provider.id === consumer.id) {
        flows.push({ from, to: instancesOf(provider), port: p.port, purpose: c.purpose ?? `${consumer.id} peers`, declaredIn: consumer.source });
      } else {
        addFlowTo(from, provider, p, c.purpose ?? `${consumer.id} uses ${provider.id} ${p.name}`, consumer.source);
      }
    }
  }

  // 2. Zones that providers accept (people's devices, the internet).
  for (const provider of services.values()) {
    for (const p of provider.provides ?? []) {
      if (!Array.isArray(p.consumers)) continue;
      for (const entry of p.consumers) {
        if (entry.startsWith('zone:')) {
          const z = zone(entry.slice(5));
          if (!z) {
            problems.push({ severity: 'error', rule: 'SEC-02', message: `${provider.id} accepts unknown zone ${entry}.`, fix: 'Use a zone from landscape.yaml.' });
            continue;
          }
          addFlowTo(z, provider, p, `${z.id} uses ${provider.id} ${p.name}`, provider.source);
        } else if (!svc(entry)) {
          problems.push({ severity: 'warning', rule: 'SEC-02', message: `${provider.id} "${p.name}" lists unknown consumer ${entry}.`, fix: 'Remove it.' });
        } else if (!svc(entry)!.consumes?.some((c) => c.service === provider.id)) {
          problems.push({ severity: 'warning', rule: 'SEC-02', message: `${provider.id} "${p.name}" accepts ${entry}, which doesn't declare that it uses it.`, fix: `Remove ${entry} from the consumers, or ${entry} declares the dependency.` });
        }
      }
    }
  }

  // 3. Platform flows every production service has.
  const production = [...services.values()].filter((s) => !s.appliance);
  for (const pf of landscape['platform-flows'] ?? []) {
    const froms: Endpoint[] = pf.from === 'all-production' ? production.map(sources)
      : pf.from.startsWith('zone:') ? [zone(pf.from.slice(5))].filter((z): z is Endpoint => !!z)
      : [svc(pf.from)].filter((s): s is Service => !!s).map(sources);
    const tos: Endpoint[] = pf.to === 'all-production' ? production.map(instancesOf)
      : [svc(pf.to)].filter((s): s is Service => !!s).map(destinations);
    for (const from of froms) {
      for (const to of tos) {
        if (from.kind === 'service' && from.id === to.id) continue;
        flows.push({ from, to, port: pf.port, purpose: pf.purpose, declaredIn: 'enterprise-architecture/landscape/landscape.yaml (platform-flows)' });
      }
    }
  }

  // 4. The egress proxy reaches the internet, on the ports of registered externals only.
  const proxy = svc(EGRESS_PROXY);
  const internet = zone('internet');
  if (proxy && internet) {
    for (const port of new Set(Object.values(landscape.externals).map((e) => e.port))) {
      flows.push({ from: sources(proxy), to: internet, port, purpose: 'Egress proxy to registered externals', declaredIn: 'enterprise-architecture/landscape/landscape.yaml (externals)' });
    }
  }

  return { flows, egress, problems };
}

/** Is a connection from `src` to `dst` on `port` allowed by the policy? */
export function isAllowed(policy: Policy, src: string, dst: string, port: number): Flow | undefined {
  return policy.flows.find((f) =>
    f.port === port &&
    f.from.addresses.some((a) => within(src, a)) &&
    f.to.addresses.some((a) => within(dst, a)));
}
