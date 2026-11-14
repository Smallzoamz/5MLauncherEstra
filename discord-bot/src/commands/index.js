import * as estra from './estra.js';
import * as fivemCheck from './fivemCheck.js';
import * as patchTemplate from './patchTemplate.js';
import * as register from './register.js';
import * as setup from './setup.js';
import * as ticket from './ticket.js';
import * as verifyHash from './verifyHash.js';

export const COMMAND_LIST = [estra, register, verifyHash, fivemCheck, patchTemplate, setup, ticket];

export const COMMAND_MAP = new Map(COMMAND_LIST.map(cmd => [cmd.data.name, cmd]));

export function getCommandJsonDefinitions() {
  return COMMAND_LIST.map(cmd => cmd.data.toJSON());
}
