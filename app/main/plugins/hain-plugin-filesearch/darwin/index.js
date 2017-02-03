'use strict';

const fs = require('original-fs');
const co = require('co');

const fileUtil = require('./file-util');
const sharedUtil = require('../shared-util');

module.exports = (context) => {
  const logger = context.logger;
  const shell = context.shell;
  const app = context.app;
  const initialPref = context.preferences.get();
  const indexer = context.indexer;
  const toast = context.toast;

  const recursiveSearchDirs = sharedUtil.injectEnvVariables(initialPref.recursiveFolders || []);
  const lazyIndexingKeys = {};

  function* findFilesAndUpdateIndexer(dirs, recursive) {
    for (const dir of dirs) {
      logger.log(`try to update files in ${dir}`);
      if (fs.existsSync(dir) === false) {
        logger.log(`can't find a dir: ${dir}`);
        continue;
      }
      const files = yield co(fileUtil.findApplications(dir, true));
      updateIndexer(dir, files);
    }
  }

  function updateIndexer(indexKey, files) {
    const indexerElements = filesToIndexerElements(files);
    indexer.set(indexKey, indexerElements);
    logger.log(`Indexer has updated ${indexKey}, ${files.length} files`);
  }

  function filesToIndexerElements(files) {
    return files.map((file) => {
      const appInfo = fileUtil.getApplicationInfo(file);
      return {
        id: file,
        primaryText: appInfo.name,
        secondaryText: appInfo.path,
        group: 'Applications'
      };
    });
  }

  function lazyRefreshIndex(dir, recursive) {
    const _lazyKey = lazyIndexingKeys[dir];
    if (_lazyKey !== undefined)
      clearTimeout(_lazyKey);

    lazyIndexingKeys[dir] = setTimeout(() => {
      co(findFilesAndUpdateIndexer([dir], recursive)).catch(logger.log);
    }, 10000);
  }

  function* setupWatchers(dirs, recursive) {
    for (const dir of dirs) {
      const _dir = dir;
      fs.watch(_dir, {
        persistent: true,
        recursive: recursive
      }, (evt, filename) => {
        lazyRefreshIndex(_dir, recursive);
      });
    }
  }

  function startup() {
    co(function* () {
      yield* findFilesAndUpdateIndexer(recursiveSearchDirs, true);
      yield* setupWatchers(recursiveSearchDirs, true);
    }).catch((err) => {
      logger.log(err);
      logger.log(err.stack);
    });
  }

  function execute(id, payload) {
    if (fs.existsSync(id) === false) {
      toast.enqueue('Sorry, Could\'nt Find a File');
      return;
    }

    app.close();
    shell.openItem(id);
  }

  return { startup, execute };
};