import { parse as parseQuotes } from 'shell-quote';

export function isInt(value: number) {
	return value === Math.floor(value);
}

export const shellArgs = (str: string) => parseQuotes(str).map((e) => e.toString());

export const executeOrLog = async (target?: string | Function, arg?: any) =>
	typeof target === 'string' ? console.log(target) : target ? await target(arg) : undefined;
