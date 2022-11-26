import { hasTsconfig, fromAegir, fromRoot, readJson } from './utils.js'
import Listr from 'listr'
import kleur from 'kleur'
import fs from 'fs-extra'
import path from 'path'
import { execa } from 'execa'
import { promisify } from 'util'
import ghPages from 'gh-pages'
import { premove as del } from 'premove/sync'
import { fileURLToPath } from 'url'

const publishPages = promisify(ghPages.publish)

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * @typedef {import("./types").GlobalOptions} GlobalOptions
 * @typedef {import("./types").DocsOptions} DocsOptions
 * @typedef {import("listr").ListrTaskWrapper} Task
 *
 * @typedef {object} Options
 * @property {string} entryPoint - Entry point for typedoc (defaults: 'src/index.js')
 * @property {string[]} forwardOptions - Extra options to forward to the backend
 */

/**
 * Docs command
 *
 * @param {GlobalOptions & DocsOptions} ctx
 * @param {Task} task
 */
const docs = async (ctx, task) => {
  let userTSConfig = readJson(fromRoot('tsconfig.json'))
  const configPath = fromRoot('tsconfig-docs.aegir.json')

  try {
    const config = {
      ...userTSConfig
    }

    if (config.compilerOptions) {
      // remove config options that cause tsdoc to fail
      delete config.compilerOptions.emitDeclarationOnly
    }

    fs.writeJsonSync(configPath, config, {
      spaces: 2
    })

    /** @type {Options} */
    const opts = {
      forwardOptions: ctx['--'] ? ctx['--'] : [],
      entryPoint: ctx.entryPoint
    }

    if (!hasTsconfig) {
      // eslint-disable-next-line no-console
      console.error(
        kleur.yellow('Documentation requires typescript config.')
      )
      return
    }

    // run typedoc
    const proc = execa(
      'typedoc',
      [
        fromRoot(opts.entryPoint),
        '--tsconfig',
        configPath,
        '--out',
        'docs',
        '--hideGenerator',
        '--includeVersion',
        '--gitRevision',
        'master',
        '--plugin',
        fromAegir('src/docs/typedoc-plugin.cjs'),
        ...opts.forwardOptions,
        'src/*'
      ],
      {
        localDir: path.join(__dirname, '..'),
        preferLocal: true
      }
    )
    proc.all?.on('data', (chunk) => {
      task.output = chunk.toString().replace('\n', '')
    })
    await proc

    // write .nojekyll file
    fs.writeFileSync('docs/.nojekyll', '')
  } finally {
    fs.removeSync(configPath)
  }
}

const publishDocs = () => {
  return publishPages(
    'docs',
    // @ts-ignore - promisify returns wrong type
    {
      dotfiles: true,
      message: 'chore: update documentation'
    }
  )
}

const tasks = new Listr(
  [
    {
      title: 'Clean ./docs',
      task: () => {
        del('docs')
        del('dist')
      }
    },
    {
      title: 'Generating documentation',
      /**
       *
       * @param {GlobalOptions & DocsOptions} ctx
       * @param {Task} task
       */
      task: docs
    },
    {
      title: 'Publish to GitHub Pages',
      task: publishDocs,
      enabled: (ctx) => ctx.publish && hasTsconfig
    }
  ],
  {
    renderer: 'verbose'
  }
)

export default tasks
