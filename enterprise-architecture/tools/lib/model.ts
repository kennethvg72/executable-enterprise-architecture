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
  /** PostgreSQL's max_connections, for database clusters (INF-05). */
  'max-connections'?: number;
  /** Connections each instance's pool may open to its database (default 10). */
  'database-connections'?: number;
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
  /** tcp unless said otherwise. Probes test TCP only; UDP is verified on the rules (DEL-06). */
  protocol?: 'tcp' | 'udp';
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
  /** Where applications may keep files of their own (DAT-06): a declared path, and the most sensitive data it may hold. */
  'file-storage'?: { path: string; classification: Classification; description?: string }[];
  /** Systems more than one application changes or draws names from, each with its one steward (OWN-10). */
  'shared-systems'?: Record<string, SharedSystem>;
}

export interface SharedSystem {
  steward: string;          // the agent role that alone writes its source
  covers: string;           // what is in it
  source: string;           // where its register lives
  'read-by'?: string[];     // who may read it, when not everyone may (ZTN-10)
}

/** One right a deployment has, on one named target (DEL-08): governance/deployment-grants/<application>.yaml. */
export interface Grant {
  id: string;
  action: string;
  target: string;
  /** The Board, or the steward of the shared system together with the Governance Agent (OWN-10). */
  'approved-by': string[];
  granted: string;
  reason: string;
  record?: string;
}

/** A step of a deployment plan, or of one of its rollbacks (DEL-09). */
export interface PlanStep {
  id?: string;
  action: string;
  target: string;
  /** Whether the application must be stopped for this step, or can keep running through it. */
  application: 'must-stop' | 'keeps-running';
  file?: string;          // systemd-unit, scheduled-task: the unit file, in the application's repository
  files?: string[];       // migrations: the files, in order; copy-file: the files
  from?: string;          // restore: the backup step it restores
}

/** releases/<id>/deployment-plan.yaml: what this release does, and how each step is undone. */
export interface DeploymentPlan {
  steps: PlanStep[];
  rollbacks: { covers: string[]; steps: PlanStep[] }[];
}

/** A pre-approved deployment action (enterprise-architecture/pipeline/deployment-actions.yaml). */
export interface DeploymentAction {
  'runs-on': string[];
  target: string;
  /** false: it changes nothing the application runs on (a backup), so there is nothing to undo. */
  'changes-production': boolean;
  /** What can undo it, on the same target: an action, or a list of actions that only undo it together, in order. */
  'undone-by'?: (string | string[])[];
  /** Only in a rollback, never as a step of its own. */
  'rollback-only'?: boolean;
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
    store: string;                 // a database cluster from the landscape, or "files"
    database?: string;             // for a database cluster
    path?: string;                 // for files: a directory on the landscape's file storage
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
    /** The pool's maximum per instance (DB_POOL_MAX), checked against the cluster's max_connections. */
    'database-connections'?: number;
    capacity: { 'peak-requests-per-second': number; 'instance-requests-per-second': number };
    connectors?: string[];        // power-apps: the connectors the solution uses (PA-07)
    distribution?: string;        // android: managed-play | play (AND-01)
  };
  provides?: Provide[];
  consumes?: Consume[];
  alerts?: { name: string; owner: string; runbook: string }[];
  temporary?: { what: string; owner: string; 'remove-by': string }[];
}

/** An exception granted by the Architecture Board (governance/exceptions/<subject>.yaml). */
export interface Exception {
  id: string;
  /** The file's name: an application, a shared system or a site in the landscape. */
  application: string;
  rules: string[];
  /** The text of the one finding it covers: a failure of its rules that doesn't contain it stays a failure. */
  finding: string;
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
