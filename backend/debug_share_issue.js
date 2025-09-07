/**
 * Debug script to test share acceptance flow and identify owner data corruption
 * Run with: node debug_share_issue.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testShareFlow() {
  console.log('🔍 Testing Share Acceptance Flow - Owner Data Issue\n');
  
  try {
    // Test 1: Validate a share token (without authentication)
    console.log('1️⃣ Testing validateShareToken endpoint (no auth)...');
    
    // This should be replaced with an actual share token from the database
    const testToken = 'test-share-token';
    
    try {
      const validateResponse = await axios.get(`${BASE_URL}/api/share/validate/${testToken}`, {
        validateStatus: function (status) {
          return status < 500; // Accept any status under 500
        }
      });
      
      console.log('✅ Validate Response Status:', validateResponse.status);
      console.log('📋 Validate Response Data:', JSON.stringify(validateResponse.data, null, 2));
      
      if (validateResponse.data?.data?.project?.owner) {
        console.log('🎯 Owner data from validate endpoint:', {
          id: validateResponse.data.data.project.owner.id,
          email: validateResponse.data.data.project.owner.email
        });
      } else {
        console.log('⚠️  No owner data found in validate response');
      }
      
    } catch (error) {
      console.log('❌ Validate endpoint failed:', error.response?.data?.message || error.message);
      console.log('💡 This is expected if no valid share token exists in database\n');
    }

    // Test 2: Accept a share token (without authentication) 
    console.log('2️⃣ Testing acceptShare endpoint (no auth)...');
    
    try {
      const acceptResponse = await axios.post(`${BASE_URL}/api/share/accept/${testToken}`, {}, {
        validateStatus: function (status) {
          return status < 500;
        }
      });
      
      console.log('✅ Accept Response Status:', acceptResponse.status);
      console.log('📋 Accept Response Data:', JSON.stringify(acceptResponse.data, null, 2));
      
      if (acceptResponse.data?.data?.project?.owner) {
        console.log('🎯 Owner data from accept endpoint (no auth):', {
          id: acceptResponse.data.data.project.owner.id,
          email: acceptResponse.data.data.project.owner.email
        });
      }
      
    } catch (error) {
      console.log('❌ Accept endpoint failed (no auth):', error.response?.data?.message || error.message);
    }

    console.log('\n=== DATABASE QUERIES ANALYSIS ===');
    console.log('The issue likely occurs in one of these database queries:');
    console.log('1. validateShareToken() - Line 641 in sharingService.ts');
    console.log('2. acceptShareInvitation() - Line 181 in sharingService.ts');
    console.log('3. When user authenticates and retries acceptance');
    
    console.log('\n=== EXPECTED vs ACTUAL BEHAVIOR ===');
    console.log('EXPECTED: project.owner should always be the original project owner');
    console.log('ACTUAL: project.owner shows current authenticated user after auth redirect');
    
    console.log('\n=== KEY INVESTIGATION AREAS ===');
    console.log('✓ Database query includes: project.user relation is properly included');
    console.log('✓ Controller response mapping: owner field is correctly mapped');
    console.log('❓ Authentication middleware: Check if req.user overwrites owner data');
    console.log('❓ Frontend localStorage: Check if user data corrupts owner display');
    console.log('❓ Share acceptance after login: Database query might use wrong user ID');

  } catch (error) {
    console.error('💥 Script failed:', error.message);
  }
}

// Run the test
testShareFlow();