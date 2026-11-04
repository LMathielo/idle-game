// Metro turns `require('./x.png')` into an asset id. Node would try to run the PNG as JavaScript, so in tests a PNG
// require returns the file's absolute path instead (a missing file still throws "Cannot find module"). Lets tests import
// the client art registry (src/components/art/images.ts) as the app does.
import { createRequire } from 'node:module';

type Loader = (module: { exports: unknown }, filename: string) => void;
const Module = createRequire(import.meta.url)('node:module') as { _extensions: Record<string, Loader> };
Module._extensions['.png'] = (module, filename) => {
  module.exports = filename;
};
