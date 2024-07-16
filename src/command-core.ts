import clone from 'clone';
import { parse as parseQuotes } from 'shell-quote';
import { BroCliError } from './brocli-error';
import { defaultEventHandler, type EventHandler, eventHandlerWrapper } from './event-handler';
import {
	type GenericBuilderInternals,
	type GenericBuilderInternalsFields,
	type OutputType,
	type ProcessedBuilderConfig,
	type ProcessedOptions,
	type TypeOf,
} from './option-builder';
import { isInt } from './util';

// Type area
export type CommandHandler<
	TOpts extends Record<string, GenericBuilderInternals> | undefined =
		| Record<string, GenericBuilderInternals>
		| undefined,
> = (
	options: TOpts extends Record<string, GenericBuilderInternals> ? TypeOf<TOpts> : undefined,
) => any;

export type CommandInfo = {
	name: string;
	aliases?: [string, ...string[]];
	description?: string;
	hidden?: boolean;
	options?: Record<string, ProcessedBuilderConfig>;
	metaInfo?: string;
	subcommands?: CommandsInfo;
};

export type CommandsInfo = Record<string, CommandInfo>;

export type EventType = 'before' | 'after';

export type BroCliConfig = {
	programName?: string;
	argSource?: string[];
	help?: string | Function;
	version?: string | Function;
	omitKeysOfUndefinedOptions?: boolean;
	hook?: (event: EventType, command: Command) => any;
	eventHandler?: EventHandler;
};

export type GenericCommandHandler = (options?: Record<string, OutputType> | undefined) => any;

export type RawCommand<
	TOpts extends Record<string, GenericBuilderInternals> | undefined =
		| Record<string, GenericBuilderInternals>
		| undefined,
	TOptsData = TOpts extends Record<string, GenericBuilderInternals> ? TypeOf<TOpts> : undefined,
	TTransformed = TOptsData extends undefined ? undefined : TOptsData,
> = {
	name?: string;
	aliases?: [string, ...string[]];
	description?: string;
	longDescription?: string;
	hidden?: boolean;
	options?: TOpts;
	help?: string | Function;
	transform?: (options: TOptsData) => TTransformed;
	handler?: (options: Awaited<TTransformed>) => any;
	subcommands?: [Command, ...Command[]];
	metaInfo?: string;
};

export type AnyRawCommand<
	TOpts extends Record<string, GenericBuilderInternals> | undefined =
		| Record<string, GenericBuilderInternals>
		| undefined,
> = {
	name?: string;
	aliases?: [string, ...string[]];
	description?: string;
	longDescription?: string;
	hidden?: boolean;
	options?: TOpts;
	help?: string | Function;
	transform?: GenericCommandHandler;
	handler?: GenericCommandHandler;
	subcommands?: [Command, ...Command[]];
	metaInfo?: string;
};

export type Command<TOptsType = any, TTransformedType = any> = {
	name: string;
	aliases?: [string, ...string[]];
	description?: string;
	longDescription?: string;
	hidden?: boolean;
	options?: ProcessedOptions;
	help?: string | Function;
	transform?: GenericCommandHandler;
	handler?: GenericCommandHandler;
	subcommands?: [Command, ...Command[]];
	parent?: Command;
	metaInfo?: string;
};

export type CommandCandidate = {
	data: string;
	originalIndex: number;
};

export type InnerCommandParseRes = {
	command: Command | undefined;
	args: string[];
};

export type TestResult<THandlerInput> = {
	type: 'handler';
	options: THandlerInput;
} | {
	type: 'help' | 'version';
} | {
	type: 'error';
	error: unknown;
};

// Message area
const unknownCommand = (caller: string) => {
	const msg = `Unknown command: '${caller}'.\nType '--help' to get help on the cli.`;

	return new Error(msg);
};

const unknownSubcommand = (command: Command, caller: string) => {
	const name = getCommandNameRecursive(command);

	const msg = `Unknown command: ${name} ${caller}.\nType '${name} --help' to get the help on command.`;

	return new Error(msg);
};

const missingRequired = (command: RawCommand<any, any, any>, missingOpts: [string[], ...string[][]]) => {
	const msg = `Command '${command.name}' is missing following required options: ${
		missingOpts.map((opt) => {
			const name = opt.shift()!;
			const aliases = opt;

			if (aliases.length) return `${name} [${aliases.join(', ')}]`;

			return name;
		}).join(', ')
	}`;

	return new Error(msg);
};

const unrecognizedOptions = (command: RawCommand<any, any, any>, unrecognizedArgs: [string, ...string[]]) => {
	const msg = `Unrecognized options for command '${command.name}': ${unrecognizedArgs.join(', ')}`;

	return new Error(msg);
};

const invalidBooleanSyntax = (matchedName: string) => {
	return new Error(
		`Invalid syntax: boolean type argument '${matchedName}' must have it's value passed in the following formats: ${matchedName}=<value> | ${matchedName} <value> | ${matchedName}.\nAllowed values: true, false, 0, 1`,
	);
};

const invalidStringSyntax = (matchedName: string) => {
	return new Error(
		`Invalid syntax: string type argument '${matchedName}' must have it's value passed in the following formats: ${matchedName}=<value> | ${matchedName} <value>`,
	);
};

const enumViolation = (matchedName: string, data: string | undefined, values: [string, ...string[]]) => {
	return new Error(
		`Invalid value: value for the argument '${matchedName}' must be either one of the following: ${
			values.join(', ')
		}; Received: ${data}`,
	);
};

const enumViolationPos = (matchedName: string, data: string | undefined, values: [string, ...string[]]) => {
	return new Error(
		`Invalid value: value for the argument '${matchedName}' must be either one of the following: ${
			values.join(', ')
		}; Received: ${data}`,
	);
};

const invalidNumberSyntax = (matchedName: string) => {
	return new Error(
		`Invalid syntax: number type argument '${matchedName}' must have it's value passed in the following formats: ${matchedName}=<value> | ${matchedName} <value>`,
	);
};

const invalidNumberValue = (matchedName: string, data: string | undefined) => {
	return new Error(
		`Invalid value: number type argument '${matchedName}' expects a number as an input, got: ${data}`,
	);
};

const invalidInteger = (matchedName: string, data: string | undefined) => {
	return new Error(
		`Invalid value: number type argument '${matchedName}' expects an integer as an input, got: ${data}`,
	);
};

const belowMin = (matchedName: string, data: string | undefined, min: number) => {
	return new Error(
		`Invalid value: number type argument '${matchedName}' expects minimal value of ${min} as an input, got: ${data}`,
	);
};

const aboveMax = (matchedName: string, data: string | undefined, max: number) => {
	return new Error(
		`Invalid value: number type argument '${matchedName}' expects maximal value of ${max} as an input, got: ${data}`,
	);
};

// Main area
const generatePrefix = (name: string) => name.startsWith('-') ? name : name.length > 1 ? `--${name}` : `-${name}`;

const validateOptions = <TOptionConfig extends Record<string, GenericBuilderInternals>>(
	config: TOptionConfig,
): ProcessedOptions<TOptionConfig> => {
	const cloned = clone(config);

	const entries: [string, GenericBuilderInternalsFields][] = [];

	const storedNames: Record<string, [string, ...string[]]> = {};

	const cfgEntries = Object.entries(cloned);

	for (const [key, value] of cfgEntries) {
		const cfg = value._.config;

		if (cfg.name === undefined) cfg.name = key;

		if (cfg.type === 'positional') continue;

		if (cfg.name!.includes('=')) {
			throw new BroCliError(
				`Can't define option ${cfg.name} - option names and aliases cannot contain '='!`,
			);
		}

		for (const alias of cfg.aliases) {
			if (alias.includes('=')) {
				throw new BroCliError(
					`Can't define option ${cfg.name} - option names and aliases cannot contain '='!`,
				);
			}
		}

		cfg.name = generatePrefix(cfg.name);

		cfg.aliases = cfg.aliases.map((a) => generatePrefix(a));
	}

	for (const [key, value] of cfgEntries) {
		const cfg = value._.config;

		if (cfg.type === 'positional') {
			entries.push([key, { config: cfg, $output: undefined as any }]);

			continue;
		}

		const reservedNames = ['--help', '-h', '--version', '-v'];

		const allNames = [cfg.name, ...cfg.aliases];

		for (const name of allNames) {
			const match = reservedNames.find((n) => n === name);
			if (match) throw new BroCliError(`Can't define option ${cfg.name} - name '${match}' is reserved!`);
		}

		const storageVals = Object.values(storedNames);

		for (const storage of storageVals) {
			const nameOccupier = storage.find((e) => e === cfg.name);

			if (!nameOccupier) continue;

			throw new BroCliError(
				`Can't define option '${cfg.name}': name is already in use by option '${storage[0]}'!`,
			);
		}

		for (const alias of cfg.aliases) {
			for (const storage of storageVals) {
				const nameOccupier = storage.find((e) => e === alias);

				if (!nameOccupier) continue;

				throw new BroCliError(
					`Can't define option '${cfg.name}': alias '${alias}' is already in use by option '${storage[0]}'!`,
				);
			}
		}

		storedNames[cfg.name!] = [cfg.name!, ...cfg.aliases];

		storedNames[cfg.name!]!.forEach((name, idx) => {
			if (storedNames[cfg.name!]!.findIndex((e) => e === name) === idx) return;

			throw new BroCliError(
				`Can't define option '${cfg.name}': duplicate aliases '${name}'!`,
			);
		});

		entries.push([key, { config: cfg, $output: undefined as any }]);
	}

	return Object.fromEntries(entries) as ProcessedOptions<any>;
};

const assignParent = (parent: Command, subcommands: Command[]) =>
	subcommands.forEach((e) => {
		e.parent = parent;
		if (e.subcommands) assignParent(e, e.subcommands);
	});

export const command = <
	TOpts extends Record<string, GenericBuilderInternals> | undefined,
	TOptsData = TOpts extends Record<string, GenericBuilderInternals> ? TypeOf<TOpts> : undefined,
	TTransformed = TOptsData,
>(command: RawCommand<TOpts, TOptsData, TTransformed>): Command<TOptsData, Awaited<TTransformed>> => {
	const allNames = command.aliases ? [command.name, ...command.aliases] : [command.name];

	const cmd: Command = clone(command) as any;
	if (
		(<AnyRawCommand> command).subcommands && command.options
		&& Object.values(command.options).find((opt) => opt._.config.type === 'positional')
	) {
		throw new BroCliError(
			`Can't define command '${cmd.name}' - command can't have subcommands and positional args at the same time!`,
		);
	}

	const processedOptions = command.options ? validateOptions(command.options) : undefined;
	cmd.options = processedOptions;

	cmd.name = cmd.name ?? cmd.aliases?.shift();

	if (!cmd.name) throw new BroCliError(`Can't define command without name!`);

	cmd.aliases = cmd.aliases?.length ? cmd.aliases : undefined;

	if (cmd.name.startsWith('-')) {
		throw new BroCliError(`Can't define command '${cmd.name}' - command name can't start with '-'!`);
	}

	cmd.aliases?.forEach((a) => {
		if (a.startsWith('-')) {
			throw new BroCliError(`Can't define command '${cmd.name}' - command aliases can't start with '-'!`);
		}
	});

	allNames.forEach((n, i) => {
		if (n === 'help') {
			throw new BroCliError(
				`Can't define command '${cmd.name}' - 'help' is a reserved name. If you want to redefine help message - do so in runCli's config.`,
			);
		}

		const lCaseName = n?.toLowerCase();
		if (lCaseName === '0' || lCaseName === '1' || lCaseName === 'true' || lCaseName === 'false') {
			throw new BroCliError(
				`Can't define command '${cmd.name}' - '${n}' is a reserved for boolean values name!`,
			);
		}

		const idx = allNames.findIndex((an) => an === n);

		if (idx !== i) throw new BroCliError(`Can't define command '${cmd.name}' - duplicate alias '${n}'!`);
	});

	if (cmd.subcommands) {
		assignParent(cmd, cmd.subcommands);
	}

	return cmd;
};

const getCommandInner = (commands: Command[], candidates: CommandCandidate[], args: string[]): InnerCommandParseRes => {
	const { data: arg, originalIndex: index } = candidates.shift()!;

	const command = commands.find((c) => {
		const names = c.aliases ? [c.name, ...c.aliases] : [c.name];
		const res = names.find((name) => name === arg);

		return res;
	});

	if (!command) {
		return {
			command,
			args,
		};
	}

	const newArgs = removeByIndex(args, index);

	if (!candidates.length || !command.subcommands) {
		return {
			command,
			args: newArgs,
		};
	}

	const newCandidates = candidates.map((c) => ({ data: c.data, originalIndex: c.originalIndex - 1 }));

	const subcommand = getCommandInner(command.subcommands!, newCandidates, newArgs);

	if (!subcommand.command) throw unknownSubcommand(command, candidates[0]!.data);

	return subcommand;
};

const getCommand = (commands: Command[], args: string[]) => {
	const candidates: CommandCandidate[] = [];

	for (let i = 0; i < args.length; ++i) {
		const arg = args[i]!;
		if (arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v') {
			const lCaseNext = args[i + 1]?.toLowerCase();
			if (lCaseNext === '0' || lCaseNext === '1' || lCaseNext === 'true' || lCaseNext === 'false') ++i;

			continue;
		}

		if (arg?.startsWith('-')) {
			if (!arg.includes('=')) ++i;

			continue;
		}

		candidates.push({
			data: arg,
			originalIndex: i,
		});
	}

	if (!candidates.length) {
		return {
			command: undefined,
			args,
		};
	}

	const firstCandidate = candidates[0]!;

	if (firstCandidate.data === 'help') {
		return {
			command: 'help' as const,
			args: removeByIndex(args, firstCandidate.originalIndex),
		};
	}

	const { command, args: argsRes } = getCommandInner(commands, candidates, args);

	if (!command) throw unknownCommand(firstCandidate.data);

	return {
		command,
		args: argsRes,
	};
};

const parseArg = (
	options: [string, ProcessedBuilderConfig][],
	positionals: [string, ProcessedBuilderConfig][],
	arg: string,
	nextArg: string | undefined,
) => {
	let data: OutputType = undefined;

	const argSplit = arg.split('=');
	const hasEq = arg.includes('=');

	const namePart = argSplit.shift();
	const dataPart = hasEq ? argSplit.join('=') : nextArg;
	let skipNext = !hasEq;

	if (namePart === '--help' || namePart === '-h') {
		return {
			isHelp: true,
		};
	}

	if (namePart === '--version' || namePart === '-v') {
		return {
			isVersion: true,
		};
	}

	if (!arg.startsWith('-')) {
		if (!positionals.length) return {};

		const pos = positionals.shift()!;

		if (pos[1].enumVals && !pos[1].enumVals.find((val) => val === dataPart)) {
			throw enumViolationPos(pos[1].name!, arg, pos[1].enumVals);
		}

		data = arg;

		return {
			data,
			skipNext: false,
			name: pos[0],
			option: pos[1],
		};
	}

	const option = options.find(([optKey, opt]) => {
		const names = [opt.name!, ...opt.aliases];

		if (opt.type === 'boolean') {
			const match = names.find((name) => name === namePart);
			if (!match) return false;

			let lcaseData = dataPart?.toLowerCase();

			if (!hasEq && nextArg?.startsWith('-')) {
				data = true;
				skipNext = false;
				return true;
			}

			if (lcaseData === undefined || lcaseData === '' || lcaseData === 'true' || lcaseData === '1') {
				data = true;
				return true;
			}

			if (lcaseData === 'false' || lcaseData === '0') {
				data = false;
				return true;
			}

			if (!hasEq) {
				data = true;
				skipNext = false;
				return true;
			}

			throw invalidBooleanSyntax(match);
		} else {
			const match = names.find((name) => name === namePart);

			if (!match) return false;

			if (opt.type === 'string') {
				if (!hasEq && nextArg === undefined) throw invalidStringSyntax(match);

				if (opt.enumVals && !opt.enumVals.find((val) => val === dataPart)) {
					throw enumViolation(match, dataPart, opt.enumVals);
				}

				data = dataPart;

				return true;
			}

			if (!hasEq && nextArg === undefined) throw invalidNumberSyntax(match);

			const numData = Number(dataPart);

			if (isNaN(numData)) throw invalidNumberValue(match, dataPart);

			if (opt.isInt && !isInt(numData)) throw invalidInteger(match, dataPart);

			if (opt.minVal !== undefined && numData < opt.minVal) throw belowMin(match, dataPart, opt.minVal);

			if (opt.maxVal !== undefined && numData > opt.maxVal) throw aboveMax(match, dataPart, opt.maxVal);

			data = dataPart;

			return true;
		}
	});

	return {
		data,
		skipNext,
		name: option?.[0],
		option: option?.[1],
	};
};

const parseOptions = (
	command: Command,
	args: string[],
	omitKeysOfUndefinedOptions?: boolean,
): Record<string, OutputType> | 'help' | 'version' | undefined => {
	const options = command.options;

	const optEntries = Object.entries(options ?? {} as Exclude<typeof options, undefined>).map(
		(opt) => [opt[0], opt[1].config] as [string, ProcessedBuilderConfig],
	);

	const nonPositionalEntries = optEntries.filter(([key, opt]) => opt.type !== 'positional');
	const positionalEntries = optEntries.filter(([key, opt]) => opt.type === 'positional');

	const result: Record<string, OutputType> = {};

	const missingRequiredArr: string[][] = [];
	const unrecognizedArgsArr: string[] = [];

	for (let i = 0; i < args.length; ++i) {
		const arg = args[i]!;
		const nextArg = args[i + 1];

		const {
			data,
			name,
			option,
			skipNext,
			isHelp,
			isVersion,
		} = parseArg(nonPositionalEntries, positionalEntries, arg, nextArg);
		if (!option) unrecognizedArgsArr.push(arg.split('=')[0]!);
		if (skipNext) ++i;

		result[name!] = data;

		if (isHelp) return 'help';
		if (isVersion) return 'version';
	}

	for (const [optKey, option] of optEntries) {
		const data = result[optKey] ?? option.default;

		if (!omitKeysOfUndefinedOptions) {
			result[optKey] = data;
		} else {
			if (data !== undefined) result[optKey] = data;
		}

		if (option.isRequired && result[optKey] === undefined) missingRequiredArr.push([option.name!, ...option.aliases]);
	}

	if (missingRequiredArr.length) throw missingRequired(command, missingRequiredArr as [string[], ...string[][]]);
	if (unrecognizedArgsArr.length) throw unrecognizedOptions(command, unrecognizedArgsArr as [string, ...string[]]);

	return Object.keys(result).length ? result : undefined;
};

const executeOrLog = async (target: string | Function | undefined) => {
	if (!target || typeof target === 'string') console.log(target);
	else await target();
};

export const getCommandNameRecursive = (command: Command): string =>
	command.parent ? `${getCommandNameRecursive(command.parent)} ${command.name}` : command.name;

const validateCommands = (commands: Command[], parent?: Command) => {
	const storedNames: Record<string, [string, ...string[]]> = {};

	for (const cmd of commands) {
		const storageVals = Object.values(storedNames);

		for (const storage of storageVals) {
			const nameOccupier = storage.find((e) => e === cmd.name);

			if (!nameOccupier) continue;

			throw new Error(
				`Can't define command '${getCommandNameRecursive(cmd)}': name is already in use by command '${
					parent ? `${getCommandNameRecursive(parent)} ` : ''
				}${storage[0]}'!`,
			);
		}

		if (cmd.aliases) {
			for (const alias of cmd.aliases) {
				for (const storage of storageVals) {
					const nameOccupier = storage.find((e) => e === alias);

					if (!nameOccupier) continue;

					throw new Error(
						`Can't define command '${getCommandNameRecursive(cmd)}': alias '${alias}' is already in use by command '${
							parent ? `${getCommandNameRecursive(parent)} ` : ''
						}${storage[0]}'!`,
					);
				}
			}
		}

		storedNames[cmd.name] = cmd.aliases
			? [cmd.name, ...cmd.aliases]
			: [cmd.name];

		if (cmd.subcommands) cmd.subcommands = validateCommands(cmd.subcommands, cmd) as [Command, ...Command[]];
	}

	return commands;
};

const removeByIndex = <T>(arr: T[], idx: number): T[] => [...arr.slice(0, idx), ...arr.slice(idx + 1, arr.length)];

const help = async (command: Command | string | undefined, commands: Command[], helpHandler: EventHandler) =>
	typeof command === 'object'
		? command.help !== undefined
			? await executeOrLog(command.help)
			: await helpHandler({
				type: 'commandHelp',
				command,
				args: [],
			})
		: await helpHandler({
			type: 'globalHelp',
			commands: commands,
			args: [],
		});

/**
 * Separated for testing purposes
 */
export const rawCli = async (commands: Command[], config?: BroCliConfig) => {
	const processedCmds = validateCommands(commands);

	const argSource = config?.argSource ?? process.argv;
	const version = config?.version;
	const help = config?.help;
	const omitKeysOfUndefinedOptions = config?.omitKeysOfUndefinedOptions ?? false;
	const eventHandler = config?.eventHandler ? eventHandlerWrapper(config.eventHandler) : defaultEventHandler;

	let args = argSource.slice(2, argSource.length);
	if (!args.length) {
		return await eventHandler({
			type: 'globalHelp',
			commands: processedCmds,
			help,
			args,
		});
	}

	const helpIndex = args.findIndex((arg) => arg === '--help' || arg === '-h');
	if (
		helpIndex !== -1 && (helpIndex > 0
			? args[helpIndex - 1]?.startsWith('-') && !args[helpIndex - 1]!.includes('=') ? false : true
			: true)
	) {
		const command = getCommand(processedCmds, args).command;

		if (typeof command === 'object') {
			return await eventHandler({
				type: 'commandHelp',
				command,
				args,
			});
		} else {
			return await eventHandler({
				type: 'globalHelp',
				commands: processedCmds,
				help,
				args,
			});
		}
	}

	const versionIndex = args.findIndex((arg) => arg === '--version' || arg === '-v');
	if (versionIndex !== -1 && (versionIndex > 0 ? args[versionIndex - 1]?.startsWith('-') ? false : true : true)) {
		return await eventHandler({
			type: 'version',
			version,
		});
	}

	const { command, args: newArgs } = getCommand(processedCmds, args);
	if (!command) {
		return await eventHandler({
			type: 'globalHelp',
			commands: processedCmds,
			help,
			args,
		});
	}

	if (command === 'help') {
		let helpCommand: Command | 'help' | undefined;
		let newestArgs: string[] = newArgs;

		do {
			const res = getCommand(processedCmds, newestArgs);
			helpCommand = res.command;
			newestArgs = res.args;
		} while (helpCommand === 'help');

		return helpCommand
			? await eventHandler({
				type: 'commandHelp',
				command: helpCommand,
				args,
			})
			: await eventHandler({
				type: 'globalHelp',
				commands: processedCmds,
				help,
				args,
			});
	}

	const optionResult = parseOptions(command, newArgs, omitKeysOfUndefinedOptions);

	if (optionResult === 'help') {
		return await eventHandler({
			type: 'commandHelp',
			command,
			args,
		});
	}
	if (optionResult === 'version') {
		return await eventHandler({
			type: 'version',
			version,
		});
	}

	if (command.handler) {
		if (config?.hook) await config.hook('before', command);
		await command.handler(command.transform ? await command.transform(optionResult) : optionResult);
		if (config?.hook) await config.hook('after', command);
		return undefined;
	} else {
		return await eventHandler({
			type: 'commandHelp',
			command,
			args,
		});
	}
};

/**
 * Runs CLI commands
 *
 * @param commands - command collection
 *
 * @param argSource - source of cli arguments, optionally passed as a parameter for testing purposes and compatibility with custom environments
 */
export const run = async (commands: Command[], config?: BroCliConfig) => {
	try {
		await rawCli(commands, config);
	} catch (e) {
		console.error(typeof e === 'object' && e !== null && 'message' in e ? e.message : e);

		process.exit(1);
	}
};

export const handler = <TOpts extends Record<string, GenericBuilderInternals>>(
	options: TOpts,
	handler: CommandHandler<TOpts>,
) => handler;

const shellArgs = (str: string) => {
	const spaces: string[] = str.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];

	return spaces.flatMap((s) => parseQuotes(s)).map((s) => s.toString());
};

export const test = async <TOpts, THandlerInput>(
	command: Command<TOpts, THandlerInput>,
	args: string,
): Promise<TestResult<THandlerInput>> => {
	try {
		const cliParsedArgs: string[] = shellArgs(args);
		const options = parseOptions(command, cliParsedArgs);

		if (options === 'help' || options === 'version') {
			return {
				type: options,
			};
		}

		return {
			options: command.transform ? await command.transform(options) : options,
			type: 'handler',
		};
	} catch (e) {
		return {
			type: 'error',
			error: e,
		};
	}
};

export const commandsInfo = (
	commands: Command[],
): CommandsInfo => {
	const validated = validateCommands(commands);

	return Object.fromEntries(validated.map((c) => [c.name, {
		name: c.name,
		aliases: c.aliases,
		description: c.description,
		isHidden: c.hidden,
		options: c.options
			? Object.fromEntries(Object.entries(c.options).map(([key, opt]) => [key, opt.config]))
			: undefined,
		metaInfo: c.metaInfo,
		subcommands: c.subcommands ? commandsInfo(c.subcommands) : undefined,
	}]));
};
