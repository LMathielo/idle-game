/** Deep copy of a JSON-shaped value. The engine never mutates its inputs. */
export function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
