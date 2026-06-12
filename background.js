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
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, data: data };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Keep your existing injection logic
chrome.action.onClicked.addListener((tab) => {
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });
});