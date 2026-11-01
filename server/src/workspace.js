// Workspace id: one instance's private namespace. The state (rung, CIBA store, history, trace) lives in the app instance created for
// that workspace, and every trace entry and state read carries the id, so two workspaces share nothing. There is no data directory
// in this demo, so nothing is written to disk. The id comes from the environment (PTL_WORKSPACE); a request never picks it.
export const DEFAULT_WORKSPACE = 'default';
const VALID = /^[a-z0-9-]{1,32}$/;
export const validWorkspaceId = (id) => typeof id === 'string' && VALID.test(id);

export function resolveWorkspace(env = process.env) {
  const id = env.PTL_WORKSPACE === undefined || env.PTL_WORKSPACE === '' ? DEFAULT_WORKSPACE : env.PTL_WORKSPACE;
  if (!validWorkspaceId(id)) throw new Error('PTL_WORKSPACE must match [a-z0-9-]{1,32}');
  return id;
}
