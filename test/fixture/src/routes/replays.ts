import { Router } from 'express';
export function createReplayRouter(deps: { now: () => number }): Router & { prune: () => void } {
  const router = Router();
  router.get('/replays/:id', showReplay);
  return Object.assign(router, { prune: () => deps.now() });
}
