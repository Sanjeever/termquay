import type { CommandTask } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

type Policy = Pick<CommandTask, 'concurrency' | 'batch_size' | 'first_host_approval' | 'stop_on_failure' | 'stop_all_on_failure'>;

export async function runCommandTask<Target, Step>(
  targets: Target[],
  steps: Step[],
  policy: Policy,
  callbacks: {
    cancelled(): boolean;
    execute(target: Target, step: Step, index: number): Promise<boolean>;
    approveFirstHost(): Promise<boolean>;
  },
) {
  let cursor = 0;
  let end = 0;
  let halted = false;

  async function worker() {
    while (!callbacks.cancelled() && !halted && cursor < end) {
      const target = targets[cursor++];
      for (let index = 0; index < steps.length && !callbacks.cancelled(); index++) {
        const failed = await callbacks.execute(target, steps[index], index);
        if (failed && policy.stop_all_on_failure) halted = true;
        if (failed && policy.stop_on_failure) break;
      }
    }
  }

  while (!callbacks.cancelled() && !halted && cursor < targets.length) {
    const first = cursor === 0 && policy.first_host_approval;
    end = Math.min(targets.length, cursor + (first ? 1 : policy.batch_size || targets.length));
    await Promise.all(Array.from({ length: Math.min(policy.concurrency || 3, end - cursor) }, worker));
    if (first && cursor < targets.length && !halted && !callbacks.cancelled()) {
      if (!await callbacks.approveFirstHost()) break;
    }
  }
}
