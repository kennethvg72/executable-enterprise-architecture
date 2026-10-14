// The application's roles and the workforce IdP groups that grant them (IAM-04).
// Keep in step with users.roles in architecture.yaml; a test checks that they match.

export const ROLE_GROUPS: Record<string, string> = {
  user: 'my-application-users',
};

export const ROLES = Object.keys(ROLE_GROUPS);

/** Roles granted by a user's IdP groups. Unknown groups grant nothing. */
export function rolesFromGroups(groups: unknown): string[] {
  const list = Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [];
  return ROLES.filter((role) => list.includes(ROLE_GROUPS[role]!));
}
