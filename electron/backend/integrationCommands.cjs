const { createMineruCommands } = require('./mineruCommands.cjs');
const { createZoteroCommands } = require('./zoteroCommands.cjs');

function createIntegrationCommands(context) {
  return {
    ...createMineruCommands(context),
    ...createZoteroCommands(context),
  };
}

module.exports = { createIntegrationCommands };
