const { AWSLocalSimulator } = require('./src/index');

const simulator = new AWSLocalSimulator();
simulator.start().catch(err => {
  console.error('Erro ao iniciar simulador:', err);
  process.exit(1);
});
