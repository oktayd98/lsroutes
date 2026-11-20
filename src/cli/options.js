'use strict';

const HELP = `Usage: lsroutes [dir] [options]

List every route of an Express, Fastify, NestJS or Hono project, like \`rails routes\`.
The project is analyzed statically: your app is never started.

Arguments:
  dir            project directory to scan (default: current directory)

Options:
  --no-cache     ignore the cached result and analyze again
  --color        force colors, e.g. when piping into \`less -R\`
  --no-color     disable colors
  -v, --version  print the version
  -h, --help     print this help

Colors are on only when printing to a terminal. The NO_COLOR and FORCE_COLOR
environment variables are honored too; --color / --no-color take precedence.
`;

const KNOWN_OPTIONS = ['--no-cache', '--color', '--no-color', '-h', '--help', '-v', '--version'];

/**
 * @param {string[]} args command line arguments, without `node` and the script
 * @returns {{ help: boolean, version: boolean, unknownOption?: string, dir?: string, cache: boolean, colorFlag?: '--color' | '--no-color' }}
 */
function parseOptions(args) {
  return {
    help: args.includes('-h') || args.includes('--help'),
    version: args.includes('-v') || args.includes('--version'),
    unknownOption: args.find((arg) => arg.startsWith('-') && !KNOWN_OPTIONS.includes(arg)),
    dir: args.find((arg) => !arg.startsWith('-')),
    cache: !args.includes('--no-cache'),
    colorFlag: args.filter((arg) => arg === '--color' || arg === '--no-color').pop(), // the last one wins, like most CLIs
  };
}

/** Flags win over environment variables, which win over terminal detection (so piping to grep stays plain). */
function shouldUseColor(colorFlag, env, stream) {
  if (colorFlag) return colorFlag === '--color';
  if (env.FORCE_COLOR) return env.FORCE_COLOR !== '0';
  return !!stream.isTTY && !env.NO_COLOR; // an empty NO_COLOR is ignored (no-color.org)
}

module.exports = { HELP, parseOptions, shouldUseColor };
