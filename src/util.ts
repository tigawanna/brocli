export function isInt(value: number) {
	return value === Math.floor(value);
}

/** Splits a command string into argv-style tokens */
export const shellArgs = (str: string): string[] => {
	const args: string[] = [];

	let current: string | undefined;
	let quote: '"' | "'" | undefined;

	for (let i = 0; i < str.length; ++i) {
		const char = str[i]!;

		if (quote === "'") {
			if (char === "'") quote = undefined;
			else current += char;
			continue;
		}

		if (quote === '"') {
			// Inside double quotes a backslash only escapes `"` and `\`
			if (char === '\\' && (str[i + 1] === '"' || str[i + 1] === '\\')) {
				current += str[++i]!;
			} else if (char === '"') quote = undefined;
			else current += char;
			continue;
		}

		if (char === '\\' && i + 1 < str.length) {
			current = (current ?? '') + str[++i]!;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			current = current ?? '';
			continue;
		}

		if (/\s/.test(char)) {
			if (current !== undefined) args.push(current);
			current = undefined;
			continue;
		}

		current = (current ?? '') + char;
	}

	if (current !== undefined) args.push(current);

	return args;
};

/** Deep-copies a value, preserving prototypes and cyclic references */
export const clone = <T>(value: T, seen: WeakMap<object, any> = new WeakMap()): T => {
	if (typeof value !== 'object' || value === null) return value;

	const existing = seen.get(value);
	if (existing !== undefined) return existing;

	if (value instanceof Date) return new Date(value.getTime()) as T;
	if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;

	if (Array.isArray(value)) {
		const copy: any[] = [];
		seen.set(value, copy);
		for (let i = 0; i < value.length; ++i) {
			if (i in value) copy[i] = clone(value[i], seen);
		}
		copy.length = value.length;
		return copy as T;
	}

	if (value instanceof Map) {
		const copy = new Map();
		seen.set(value, copy);
		for (const [k, v] of value) copy.set(clone(k, seen), clone(v, seen));
		return copy as T;
	}

	if (value instanceof Set) {
		const copy = new Set();
		seen.set(value, copy);
		for (const v of value) copy.add(clone(v, seen));
		return copy as T;
	}

	// Leave exotic objects (buffers, typed arrays, promises, ...) by reference
	if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Promise) return value;

	const copy = Object.create(Object.getPrototypeOf(value));
	seen.set(value, copy);

	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;

		if (descriptor.get || descriptor.set) {
			Object.defineProperty(copy, key, descriptor);
			continue;
		}

		descriptor.value = clone(descriptor.value, seen);
		Object.defineProperty(copy, key, descriptor);
	}

	return copy as T;
};

export const executeOrLog = async (target?: string | Function, arg?: any) =>
	typeof target === 'string' ? console.log(target) : target ? await target(arg) : undefined;
