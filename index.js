import { AWSLocalSimulator} from  './src/index.js';

const simulator = new AWSLocalSimulator();
await simulator.start();
