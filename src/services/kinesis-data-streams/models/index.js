/**
 * Kinesis Data Streams Models
 */

const { Stream, Shard } = require('./stream');
const Record = require('./record');

module.exports = {
  Stream,
  Shard,
  Record
};
