// background.js

// Listen for messages from content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TODOIST_API_CALL') {
    handleApiCall(request.data).then(sendResponse);
    return true; // Keep the message channel open for async response
  }
});

async function handleApiCall({ method, url, body, token }) {
  try {
    const options = {
      method: method || 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    // Handle empty responses (like 204 No Content)
    if (response.status === 204) {
      return { success: true, data: null };
    }

    if (!response.ok) {
      return { success: false, error: `API Error: ${response.status}`, status: response.status };
    }

    const data = await response.json();
    return { success: true, data: data };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Inject the sidebar on toolbar click. Browser pages (chrome://), the Web
// Store, and file:// URLs without access reject injection — show a badge so
// the click never fails silently.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#db4c3f' });
    chrome.action.setTitle({ tabId: tab.id, title: "Can't open the sidebar on this page — try it on a regular website" });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      chrome.action.setTitle({ tabId: tab.id, title: 'Toggle Tasks' });
    }, 4000);
  }
});