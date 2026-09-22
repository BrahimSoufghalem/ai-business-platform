export function workerStatus() {
  return {
    service: 'worker',
    status: 'ready' as const,
  };
}

console.log(JSON.stringify(workerStatus()));
