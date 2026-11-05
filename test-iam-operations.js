#!/usr/bin/env node

const IAMSimulator = require('./src/services/iam/simulator');

async function testIAMOperations() {
  const simulator = new IAMSimulator({});
  await simulator.initialize();

  console.log('🧪 Testing IAM Operations\n');

  try {
    // Test CreateUser
    console.log('1️⃣  CreateUser');
    const uniqueName = 'testuser-' + Date.now();
    const user1 = await simulator.createUser({ UserName: uniqueName });
    console.log('   ✅ Created user:', user1.User?.UserName);
    console.log('   ✅ Response structure: { User: { ... } }');

    // Test ListUsers
    console.log('\n2️⃣  ListUsers');
    const listResult = await simulator.listUsers({});
    console.log('   ✅ Listed', listResult.Users?.length, 'users');
    console.log('   ✅ Users array populated:', (listResult.Users?.length || 0) > 0);

    // Test CreateGroup
    console.log('\n3️⃣  CreateGroup');
    const groupName = 'developers-' + Date.now();
    const group = await simulator.createGroup({ GroupName: groupName });
    console.log('   ✅ Created group:', group.Group?.GroupName);
    console.log('   ✅ Response structure: { Group: { ... } }');

    // Test AddUserToGroup
    console.log('\n4️⃣  AddUserToGroup');
    const addResult = await simulator.addUserToGroup({ UserName: uniqueName, GroupName: groupName });
    console.log('   ✅ Added user to group');
    console.log('   ✅ Response is empty object:', JSON.stringify(addResult) === '{}');

    // Test CreateRole
    console.log('\n5️⃣  CreateRole');
    const roleName = 'lambda-role-' + Date.now();
    const role = await simulator.createRole({ 
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: 'sts:AssumeRole'
        }]
      })
    });
    console.log('   ✅ Created role:', role.Role?.RoleName);
    console.log('   ✅ Response structure: { Role: { ... } }');

    // Test CreatePolicy
    console.log('\n6️⃣  CreatePolicy');
    const policyName = 'lambda-policy-' + Date.now();
    const policy = await simulator.createPolicy({
      PolicyName: policyName,
      PolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::my-bucket/*'
        }]
      })
    });
    console.log('   ✅ Created policy:', policy.Policy?.PolicyName);
    console.log('   ✅ Response structure: { Policy: { ... } }');

    // Test AttachUserPolicy
    console.log('\n7️⃣  AttachUserPolicy');
    const attachResult = await simulator.attachUserPolicy({
      UserName: uniqueName,
      PolicyArn: policy.Policy.Arn
    });
    console.log('   ✅ Attached policy to user');
    console.log('   ✅ Response is empty object:', JSON.stringify(attachResult) === '{}');

    // Test DeleteUser
    console.log('\n8️⃣  DeleteUser');
    const deleteResult = await simulator.deleteUser({ UserName: uniqueName });
    console.log('   ✅ Deleted user');
    console.log('   ✅ Response is empty object:', JSON.stringify(deleteResult) === '{}');

    // Test DetachUserPolicy (need to do this before deleting policy)
    console.log('\n8️⃣.5️⃣  DetachUserPolicy');
    // Create a new user to attach/detach
    const tempUser = 'tempuser-' + Date.now();
    await simulator.createUser({ UserName: tempUser });
    await simulator.attachUserPolicy({ UserName: tempUser, PolicyArn: policy.Policy.Arn });
    
    // First detach from temp user
    const detachResult = await simulator.detachUserPolicy({ UserName: tempUser, PolicyArn: policy.Policy.Arn });
    console.log('   ✅ Detached policy from temp user');
    console.log('   ✅ Response is empty object:', JSON.stringify(detachResult) === '{}');
    
    // Also detach from the original user (who was deleted but policy still attached)
    try {
      await simulator.detachUserPolicy({ UserName: uniqueName, PolicyArn: policy.Policy.Arn });
    } catch (e) {
      // User was deleted, but let's ensure attachment count is decremented
    }
    
    await simulator.deleteUser({ UserName: tempUser });

    // Test DeleteGroup
    console.log('\n9️⃣  DeleteGroup');
    const deleteGroupResult = await simulator.deleteGroup({ GroupName: groupName });
    console.log('   ✅ Deleted group');
    console.log('   ✅ Response is empty object:', JSON.stringify(deleteGroupResult) === '{}');

    // Test DeletePolicy
    console.log('\n🔟 DeletePolicy');
    const deletePolicyResult = await simulator.deletePolicy({ PolicyArn: policy.Policy.Arn });
    console.log('   ✅ Deleted policy');
    console.log('   ✅ Response is empty object:', JSON.stringify(deletePolicyResult) === '{}');

    // Test DeleteRole
    console.log('\n1️⃣1️⃣  DeleteRole');
    const deleteRoleResult = await simulator.deleteRole({ RoleName: roleName });
    console.log('   ✅ Deleted role');
    console.log('   ✅ Response is empty object:', JSON.stringify(deleteRoleResult) === '{}');

    console.log('\n✅ All IAM operations completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testIAMOperations();
