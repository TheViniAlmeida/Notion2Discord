const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = () => Promise<void>;

export class JobQueue {
  private jobs: Job[] = [];
  private running = false;
  private waiters: (() => void)[] = [];
  private retries: number;
  private baseDelayMs: number;
  private onError: (err: unknown) => void;

  constructor(opts?: {
    retries?: number;
    baseDelayMs?: number;
    onError?: (err: unknown) => void;
  }) {
    this.retries = opts?.retries ?? 3;
    this.baseDelayMs = opts?.baseDelayMs ?? 250;
    this.onError = opts?.onError ?? (() => {});
  }

  push(job: Job): void {
    this.jobs.push(job);
    if (!this.running) void this.run();
  }

  idle(): Promise<void> {
    if (!this.running && this.jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async run(): Promise<void> {
    this.running = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      for (let attempt = 0; ; attempt++) {
        try {
          await job();
          break;
        } catch (err) {
          if (attempt >= this.retries) {
            this.onError(err);
            break;
          }
          await sleep(this.baseDelayMs * 2 ** attempt);
        }
      }
    }
    this.running = false;
    for (const w of this.waiters.splice(0)) w();
  }
}
