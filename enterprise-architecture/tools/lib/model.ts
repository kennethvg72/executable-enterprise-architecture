// The NATAX landscape and application manifests, as the tools see them.
// Field names follow the YAML files (kebab-case), so these types read like the files.

export type ResilienceClass = 'A' | 'B' | 'C';
export type Classification = 'public' | 'internal' | 'confidential' | 'taxpayer-restricted';

export const CLASSIFICATION_ORDER: Classification[] = ['public', 'internal', 'confidential', 'taxpayer-restricted'];

export interface Site {
  name: string;
  kind: 'datacenter' | 'witness';
  prefix: string;
  'capacity-vcpu'?: number;
  'test-acceptance-vcpu'?: number;
  transit?: boolean;
}

export interface Link {
  between: [string, string];
  network: string; // 'wan' is in-band; anything else is not
  gbps?: number;
  description?: string;
}

export interface Zone {
  description?: string;
  cidrs: string[];
}

export interface External {
  fqdn: string;
  /** Required for a wildcard fqdn: why nothing narrower works, and what limits the risk. */
  'wildcard-reason'?: string;
  port: number;
  consumers: string[] | 'any';
}

export interface Instance {
  site: string;
  address: string;
}

/** Who may consume an interface: a list of services and zones (zone:<id>), or a keyword. */
export type ConsumerList = string[] | 'all-production' | 'database-owners' | 'declared-externals';

export interface Provide {
  name: string;
  port: number;
  via?: string;
  'frontend-port'?: number;
  health?: { port: number; path: string };
  consumers: ConsumerList;
}

export interface Consume {
  service?: string;
  interface?: string;
  database?: string;
  external?: string;
  critical?: boolean;
  purpose?: string;
}

export interface Service {
  id: string;
  kind: string;
  description?: string;
  class: ResilienceClass;
  owner: string;
  instances: Instance[];
  /** Addresses that receive traffic for the service, when they differ from its instances (load balancers). */
  vips?: Instance[];
  /** Addresses the service's outbound traffic comes from, when they differ from its instances (OpenShift namespaces). */
  egress?: Instance[];
  provides?: Provide[];
  consumes?: Consume[];
  databases?: { name: string; owner: string }[];
  classification?: Classification;
  replication?: { synchronous: boolean; strict: boolean; promote: string; watchdog: string };
  voting?: boolean;
  contained?: boolean;
  appliance?: boolean;
  platform?: string;
  'peak-vcpu'?: number;
  /** Where this service was declared: landscape.yaml or an application's architecture.yaml. */
  source: string;
}

export interface PlatformFlow {
  from: string;
  to: string;
  port: number;
  purpose: string;
}

export interface Placement {
  path: string;
  instances: Instance[];
}

export interface Landscape {
  sites: Record<string, Site>;
  links: Link[];
  zones: Record<string, Zone>;
  externals: Record<string, External>;
  'platform-flows': PlatformFlow[];
  services: Record<string, Omit<Service, 'id' | 'source'>>;
  placements: Record<string, Placement>;
}

export interface Manifest {
  application: string;
  description: string;
  'problem-owner': string;
  'landscape-check'?: string;
  'technical-owner'?: string | null;
  architecture: Record<string, string>;
  exposure: 'internal' | 'staff-edge' | 'internet';   // staff-edge: staff APIs at the edge, for managed devices
  users: {
    'identity-provider': 'workforce' | 'customer';
    roles: { name: string; group: string; description?: string }[];
  };
  data?: {
    store: string;
    database: string;
    classification: Classification;
    'system-of-record-for'?: string[];
    'derived-copies'?: string[];
    'audit-retention'?: string;
    retention: string;
  }[];
  resilience: { class: ResilienceClass; statement: string };
  runtime: {
    technology: string;
    sites: string[];
    'instances-per-site': number;
    'peak-vcpu': number;
    capacity: { 'peak-requests-per-second': number; 'instance-requests-per-second': number };
    connectors?: string[];        // power-apps: the connectors the solution uses (PA-07)
    distribution?: string;        // android: managed-play | play (AND-01)
  };
  provides?: Provide[];
  consumes?: Consume[];
  alerts?: { name: string; owner: string; runbook: string }[];
  temporary?: { what: string; owner: string; 'remove-by': string }[];
}

/** An exception granted by the Architecture Board (governance/exceptions.yaml). */
export interface Exception {
  id: string;
  application: string;
  rules: string[];
  reason: string;
  'compensating-controls': string;
  owner: string;
  granted: string;
  expires: string;
  record?: string;
}

/** The landscape with every placed application merged in as a service. */
export interface Model {
  root: string;
  landscape: Landscape;
  services: Map<string, Service>;
  manifests: Map<string, { dir: string; manifest: Manifest }>;
}
