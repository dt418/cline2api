interface PendingReader<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: Error) => void;
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: PendingReader<T>[] = [];
  private closed = false;
  private closeError: Error | undefined;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const reader = this.readers.shift();
    if (reader !== undefined) {
      reader.resolve({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close(error?: Error): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.closeError = error;

    while (this.readers.length > 0) {
      const reader = this.readers.shift();
      if (reader === undefined) {
        continue;
      }

      if (error !== undefined) {
        reader.reject(error);
      } else {
        reader.resolve({ value: undefined, done: true });
      }
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      const value = this.values.shift() as T;
      return Promise.resolve({ value, done: false });
    }

    if (this.closed) {
      if (this.closeError !== undefined) {
        return Promise.reject(this.closeError);
      }

      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.readers.push({ resolve, reject });
    });
  }
}
