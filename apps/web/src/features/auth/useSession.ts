import { useSyncExternalStore } from "react";

import { session, type StoredSession } from "../../shared/lib/session";

export function useSession(): StoredSession | null {
  return useSyncExternalStore(session.subscribe, session.get, session.get);
}
