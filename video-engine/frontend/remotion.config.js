/** 
 * Remotion config that supports our Tailwind layout.
 * We must instruct the default Webpack bundler to parse index.css through PostCSS
 */
import { enableTailwind } from '@remotion/tailwind'
import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)

Config.overrideWebpackConfig((currentConfiguration) => {
  return enableTailwind(currentConfiguration)
})
