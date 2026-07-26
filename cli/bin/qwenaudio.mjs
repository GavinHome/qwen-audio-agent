#!/usr/bin/env node

import { main } from '../src/launcher.mjs'

main(process.argv.slice(2)).then(code => {
  if (Number.isInteger(code)) process.exitCode = code
}).catch(error => {
  process.stderr.write(`qwenaudio: ${error.message}\n`)
  process.exitCode = 1
})
