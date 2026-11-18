import React, { useCallback, useState } from 'react';

// Asks before a workspace change stops the running timer. Returns [ask(name) => Promise<boolean>, prompt].
export function useStopTimerPrompt() {
  const [pending, setPending] = useState(null);

  const ask = useCallback((name) => new Promise((resolve) => setPending({ name, resolve })), []);

  const answer = (yes) => {
    if (pending) pending.resolve(yes);
    setPending(null);
  };

  const prompt = pending && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="stop-timer-title">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-lg">
        <div id="stop-timer-title" className="text-base font-semibold text-gray-800">A timer is running</div>
        <p className="text-sm text-gray-600 mt-2">
          {pending.name ? `Switching to ${pending.name} stops the running timer.` : 'Switching workspace stops the running timer.'} Your tracked time so far is saved.
        </p>
        <div className="flex justify-end gap-3 mt-5">
          <button type="button" className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-medium text-sm cursor-pointer" onClick={() => answer(false)}>
            Keep tracking
          </button>
          <button type="button" className="px-4 py-2 rounded bg-[#2F3990] text-white hover:bg-[#252d75] font-medium text-sm cursor-pointer" onClick={() => answer(true)}>
            Stop and switch
          </button>
        </div>
      </div>
    </div>
  );

  return [ask, prompt];
}
