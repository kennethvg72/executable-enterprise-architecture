// The application's roles (IAM-04). In the workforce IdP (Microsoft Entra ID), each role is an
// app role of the application's registration, and the group named here is assigned to it. Tokens
// then carry the role values in their `roles` claim. Never authorize on group names: they aren't
// unique, and Entra ID sends group object IDs, not names.
// Keep in step with users.roles in architecture.yaml; a test checks that they match.

export const ROLE_GROUPS: Record<string, string> = {
  user: 'my-application-users',   // app role value -> the group assigned to it in the IdP
};

export const ROLES = Object.keys(ROLE_GROUPS);

/** Roles from a token's `roles` claim. Unknown values grant nothing. */
export function rolesFromClaims(roles: unknown): string[] {
  const list = Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
  return ROLES.filter((role) => list.includes(role));
}
