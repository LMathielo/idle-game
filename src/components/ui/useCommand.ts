// Dispatch helper for screens: one command at a time (a ref, so two taps in the same frame never send two), engine
// refusals shown in a GameDialog ("Not possible") and save failures as "Could not save". Resolves true when the
// engine accepted the command, so it plugs straight into PixelButton `repeat` (false stops the repeat).
// `quiet` (repeat ticks) never opens a dialog: a held button just stops.
import { useCallback, useRef } from 'react';
import { useGameClient } from '../../client/GameProvider';
import type { CommandInput, DispatchResult } from '../../client/types';
import { useDialog } from './GameDialog';

type Options = {
  /** Error codes that only mean "the screen was stale" (e.g. LOG_CHANGED): no dialog, the screen already shows the new state. */
  silentCodes?: readonly string[];
};

export type Send = (cmd: CommandInput, info?: { quiet?: boolean }) => Promise<boolean>;

export function useCommand({ silentCodes }: Options = {}) {
  const client = useGameClient();
  const dialog = useDialog();
  const inFlight = useRef(false);
  const silentKey = silentCodes?.join('|') ?? '';

  /** Runs any client call (dispatch or a debug helper) under the same one-at-a-time guard and error handling. */
  const runResult = useCallback(
    async (call: () => Promise<DispatchResult>, info?: { quiet?: boolean }): Promise<Extract<DispatchResult, { ok: true }> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      try {
        const res = await call();
        if (!res.ok) {
          if (!info?.quiet && !silentKey.split('|').includes(res.error.code)) void dialog.notPossible(res.error.message);
          return null;
        }
        return res;
      } catch (err) {
        if (!info?.quiet) void dialog.saveFailed(err instanceof Error ? err.message : undefined);
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [dialog, silentKey],
  );

  const run = useCallback(async (call: () => Promise<DispatchResult>, info?: { quiet?: boolean }): Promise<boolean> => (await runResult(call, info)) !== null, [runResult]);

  const send: Send = useCallback((cmd, info) => run(() => client.dispatch(cmd), info), [client, run]);
  /** Like `send`, but resolves the accepted DispatchResult (with the engine's events), or null when refused / busy / failed. */
  const sendForResult = useCallback((cmd: CommandInput, info?: { quiet?: boolean }) => runResult(() => client.dispatch(cmd), info), [client, runResult]);

  return { send, sendForResult, run, dialog, client };
}
