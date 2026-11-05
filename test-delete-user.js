#!/usr/bin/env node

const IAMSimulator = require('./src/services/iam/simulator');
const IAMServer = require('./src/services/iam/server');
const logger = require('./src/utils/logger');
const http = require('http');

async function test() {
  const config = { ports: { iam: 4007 } };
  const simulator = new IAMSimulator(config);
  await simulator.initialize();
  
  // Create a user first
  await simulator.createUser({ UserName: 'testuser', Path: '/' });
  console.log('✅ User created\n');
  
  const server = new IAMServer(simulator, logger, config);
  const httpServer = server.getApp().listen(4007, () => {
    console.log('✅ Server started\n');
    
    // Delete the user
    const postData = `Action=DeleteUser&UserName=testuser`;
    
    const req = http.request({
      hostname: 'localhost',
      port: 4007,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('📊 Delete Response:\n');
        
        if (data.includes('DeleteUserResponse')) {
          console.log('✅ SUCCESS! Response contains DeleteUserResponse');
        } else {
          console.log('❌ ERROR! No DeleteUserResponse');
        }
        
        // Show response (formatted)
        console.log('\nResponse (first 400 chars):');
        console.log(data.substring(0, 400));
        
        httpServer.close(() => process.exit(0));
      });
    });
    
    req.on('error', err => {
      console.error('Error:', err);
      httpServer.close(() => process.exit(1));
    });
    
    req.write(postData);
    req.end();
  });
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
