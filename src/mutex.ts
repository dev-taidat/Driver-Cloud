// Khoa don gian: noi tiep cac thao tac de tranh ghi de khi chay song song.
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn());
    // bo qua loi de chuoi khoa khong bi dut
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
