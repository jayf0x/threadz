import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getPhoneDb } from "@/lib/data";
import { PhoneOpenError } from "@/lib/phoneDb";
import { requestPersistence } from "@/lib/storage";
import { RecoveryScreen } from "./RecoveryScreen";

/** Renders the app once the phone database has opened; if it won't open, the recovery screen instead. */
export const RecoveryGate = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<"opening" | "ready" | { error: PhoneOpenError }>("opening");

  const open = useCallback(() => {
    getPhoneDb().then(
      () => setState("ready"),
      (e) => setState({ error: e instanceof PhoneOpenError ? e : new PhoneOpenError(String(e?.message ?? e)) }),
    );
  }, []);

  useEffect(() => {
    void requestPersistence();
    open();
  }, [open]);

  if (state === "ready") return children;
  if (state === "opening") return null;
  return <RecoveryScreen error={state.error} />;
};
