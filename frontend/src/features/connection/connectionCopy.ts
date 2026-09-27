export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const describePending = (pending: number) =>
  pending ? `${plural(pending, "change")} waiting to sync` : "Nothing waiting to sync";
