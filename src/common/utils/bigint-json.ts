declare global {
  interface BigInt {
    toJSON(): number;
  }
}

if (!(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return Number(this);
  };
}

export {};
