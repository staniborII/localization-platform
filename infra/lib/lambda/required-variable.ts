/**
 * Reads a variable the stack must set on a Lambda.
 * The handler stops when that variable is missing.
 */

/** Returns the variable, or throws when the stack did not set it. */
export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}
