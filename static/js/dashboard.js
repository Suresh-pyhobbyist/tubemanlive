document.addEventListener('DOMContentLoaded', function() {
    // --- DOM Element References ---
    const videoUrlInput = document.getElementById('videoUrlInput');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const scrapingStatus = document.getElementById('scrapingStatus');
    const currentVideoUrlDisplay = document.getElementById('currentVideoUrl');
    const totalMessagesElement = document.getElementById('totalMessages');
    const positiveMessagesElement = document.getElementById('positiveMessages');
    const negativeMessagesElement = document.getElementById('negativeMessages'); // Corrected typo here
    const neutralMessagesElement = document.getElementById('neutralMessages');
    const liveChatFeed = document.getElementById('liveChatFeed');
    const negativeAuthorsList = document.getElementById('negativeAuthorsList');
    const positiveAuthorsList = document.getElementById('positiveAuthorsList');
    const negativeAuthorsCountSpan = document.getElementById('negativeAuthorsCount');
    const positiveAuthorsCountSpan = document.getElementById('positiveAuthorsCount');
    const lastUpdateElement = document.getElementById('lastUpdate');

    // --- Download Buttons ---
    const downloadNegativeAuthorsBtn = document.getElementById('downloadNegativeAuthorsBtn');
    const downloadPositiveAuthorsBtn = document.getElementById('downloadPositiveAuthorsBtn');

    // --- Modal Elements (Add these to your HTML if not already present) ---
    const authorMessagesModal = document.getElementById('authorMessagesModal');
    const modalAuthorName = document.getElementById('modalAuthorName');
    const modalMessagesContent = document.getElementById('modalMessagesContent');
    const closeModalBtn = document.getElementById('closeModalBtn');


    // --- Data Storage and Chart Variables ---
    let sentimentChart;
    let fetchIntervalId;

    // Store ALL messages locally on the frontend, categorized by author and sentiment
    // This store will now accumulate messages over time.
    const allMessagesStore = {
        negative: {}, // { "Author Name": [{id:1, message: "msg", timestamp: "time"}, ...] }
        positive: {},
        neutral: {}
    };

    // New variable to track the highest message ID received from the backend
    let lastMessageIdReceived = 0;

    // --- Chart.js Initialization ---
    const ctx = document.getElementById('sentimentChart').getContext('2d');
    sentimentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Positive', 'Negative', 'Neutral'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: ['#22c55e', '#ef4444', '#94a3b8'],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#cbd5e1'
                    }
                },
                title: {
                    display: false,
                }
            }
        }
    });

    // --- Helper Function: Download Data ---
    function downloadData(filename, data) {
        const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- Helper Function: Generate and Download Author Messages ---
    function generateAndDownloadAuthorMessages(sentimentType) {
        const authorsData = allMessagesStore[sentimentType];
        if (Object.keys(authorsData).length === 0) {
            alert(`No ${sentimentType} authors and messages to download yet.`);
            return;
        }

        let output = `YouTube Live Chat ${sentimentType.charAt(0).toUpperCase() + sentimentType.slice(1)} Authors and Messages\n`;
        output += `Generated on: ${new Date().toLocaleString()}\n\n`;

        for (const author in authorsData) {
            output += `--- Author: ${author} (Messages: ${authorsData[author].length})---\n`;
            authorsData[author].forEach(msg => {
                let msgTimestamp = new Date(msg.timestamp);
                let formattedMsgTime = !isNaN(msgTimestamp.getTime()) ? msgTimestamp.toLocaleString() : 'N/A Time';
                output += `[${formattedMsgTime}] ${msg.message}\n`; // Use msg.message from now on
            });
            output += "\n";
        }

        const filename = `youtube_chat_${sentimentType}_authors_messages_${new Date().toISOString().slice(0, 10)}.txt`;
        downloadData(filename, output);
    }

    // --- UI Update Function: Scraping Status ---
    function updateScrapingStatus(isActive, url = "") {
        if (isActive) {
            scrapingStatus.textContent = 'Active';
            scrapingStatus.className = 'status-active';
            stopButton.disabled = false;
            startButton.disabled = true;
            videoUrlInput.disabled = true;
            currentVideoUrlDisplay.textContent = url;
        } else {
            scrapingStatus.textContent = 'Inactive';
            scrapingStatus.className = 'status-inactive';
            stopButton.disabled = true;
            startButton.disabled = false;
            videoUrlInput.disabled = false;
            currentVideoUrlDisplay.textContent = 'None';
        }
    }

    // --- Helper Function: Process and Display Single Message ---
    // This function handles adding a single message to the chat feed and storing it.
    function processAndDisplayMessage(messageData) {
        const chatMessageDiv = document.createElement('div');
        let sentimentClass = 'neutral';
        if (messageData.is_positive) {
            sentimentClass = 'positive';
        } else if (messageData.is_negative) {
            sentimentClass = 'negative';
        }
        chatMessageDiv.className = `chat-message p-3 mb-2 rounded-lg text-sm animate-message-appear ${sentimentClass}`;

        let formattedTimestamp = '';
        const dateObj = new Date(messageData.timestamp);
        if (!isNaN(dateObj.getTime())) {
            formattedTimestamp = dateObj.toLocaleTimeString();
        } else {
            console.warn('Invalid timestamp received for message:', messageData.timestamp, 'Message:', messageData.message);
            formattedTimestamp = 'N/A Time';
        }

        chatMessageDiv.innerHTML = `
            <div class="flex items-baseline mb-1">
                <span class="font-bold text-gray-300 mr-2">${messageData.author}:</span>
                <span class="text-gray-400 text-xs">${formattedTimestamp}</span>
            </div>
            <p>${messageData.message}</p>
        `;

        liveChatFeed.prepend(chatMessageDiv); // Prepend new messages (for flex-direction: column-reverse in CSS)

        // Remove "No messages" placeholder if it exists
        const noMessagesPlaceholder = liveChatFeed.querySelector('.no-messages');
        if (noMessagesPlaceholder) {
            noMessagesPlaceholder.remove();
        }

        // Store the message in the allMessagesStore for download and prominent authors list
        const sentimentKey = messageData.is_positive ? 'positive' : (messageData.is_negative ? 'negative' : 'neutral');
        if (!allMessagesStore[sentimentKey][messageData.author]) {
            allMessagesStore[sentimentKey][messageData.author] = [];
        }
        // Store full message data including the ID, author, timestamp, and the message text itself
        allMessagesStore[sentimentKey][messageData.author].push(messageData);
    }

    // --- Helper Function: Sort Author List ---
    function sortAuthorList(ulElement, countsStore) {
        const items = Array.from(ulElement.children);
        if (items.length === 1 && items[0].classList.contains('text-gray-600')) {
            return;
        }

        items.sort((a, b) => {
            const authorA = a.getAttribute('data-author');
            const authorB = b.getAttribute('data-author');
            return (countsStore[authorB]?.length || 0) - (countsStore[authorA]?.length || 0);
        });
        items.forEach(item => ulElement.appendChild(item));
    }

    // --- Modal Functions (ensure these IDs and structure are in your HTML) ---
    function showAuthorMessagesModal(author, sentimentType) {
        modalAuthorName.textContent = `${author}'s ${sentimentType.charAt(0).toUpperCase() + sentimentType.slice(1)} Messages`;
        modalMessagesContent.innerHTML = ''; // Clear previous messages

        const messages = allMessagesStore[sentimentType][author];
        if (messages && messages.length > 0) {
            messages.sort((a, b) => {
                const dateA = new Date(a.timestamp);
                const dateB = new Date(b.timestamp);
                return dateA.getTime() - dateB.getTime();
            });

            messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                let sentimentClass = 'neutral';
                if (msg.is_positive) {
                    sentimentClass = 'positive';
                } else if (msg.is_negative) {
                    sentimentClass = 'negative';
                }
                msgDiv.className = `modal-message text-sm ${sentimentClass}`;

                let formattedTimestamp = '';
                const dateObj = new Date(msg.timestamp);
                if (!isNaN(dateObj.getTime())) {
                    formattedTimestamp = dateObj.toLocaleString();
                } else {
                    formattedTimestamp = 'N/A Time';
                }

                msgDiv.innerHTML = `
                    <div class="text-gray-400 text-xs mb-1">${formattedTimestamp}</div>
                    <p>${msg.message}</p>
                `;
                modalMessagesContent.appendChild(msgDiv);
            });
        } else {
            modalMessagesContent.innerHTML = `<p class="text-gray-600 text-center py-4">No ${sentimentType} messages found for ${author}.</p>`;
        }
        
        authorMessagesModal.classList.remove('hidden'); // Show the modal
    }

    function hideAuthorMessagesModal() {
        authorMessagesModal.classList.add('hidden'); // Hide the modal
    }

    // New function to update author lists explicitly from the accumulated store
    function updateAuthorLists() {
        // Update negative authors list
        negativeAuthorsList.innerHTML = ''; // Clear to rebuild
        const negativeAuthorsInStore = Object.keys(allMessagesStore.negative);
        if (negativeAuthorsInStore.length === 0) {
            negativeAuthorsList.innerHTML = '<li class="text-gray-600 text-center py-2">No negative authors yet.</li>';
        } else {
            negativeAuthorsInStore.forEach(author => {
                const li = document.createElement('li');
                li.className = 'py-1 px-2 rounded hover:bg-gray-800 cursor-pointer author-item';
                li.setAttribute('data-author', author);
                li.setAttribute('data-sentiment', 'negative'); // Add sentiment type for modal
                li.textContent = `${author} (${allMessagesStore.negative[author].length})`; // Display message count
                negativeAuthorsList.appendChild(li);
            });
            sortAuthorList(negativeAuthorsList, allMessagesStore.negative);
        }
        negativeAuthorsCountSpan.textContent = negativeAuthorsInStore.length;

        // Update positive authors list
        positiveAuthorsList.innerHTML = ''; // Clear to rebuild
        const positiveAuthorsInStore = Object.keys(allMessagesStore.positive);
        if (positiveAuthorsInStore.length === 0) {
            positiveAuthorsList.innerHTML = '<li class="text-gray-600 text-center py-2">No positive authors yet.</li>';
        } else {
            positiveAuthorsInStore.forEach(author => {
                const li = document.createElement('li');
                li.className = 'py-1 px-2 rounded hover:bg-gray-800 cursor-pointer author-item';
                li.setAttribute('data-author', author);
                li.setAttribute('data-sentiment', 'positive'); // Add sentiment type for modal
                li.textContent = `${author} (${allMessagesStore.positive[author].length})`; // Display message count
                positiveAuthorsList.appendChild(li);
            });
            sortAuthorList(positiveAuthorsList, allMessagesStore.positive);
        }
        positiveAuthorsCountSpan.textContent = positiveAuthorsInStore.length;

        // Re-attach click listeners to newly created author list items
        document.querySelectorAll('.authors-list .author-item').forEach(item => {
            // Remove existing listener to prevent duplicates if updateAuthorLists is called multiple times
            item.removeEventListener('click', handleAuthorClick); 
            item.addEventListener('click', handleAuthorClick);
        });
    }

    // Centralized handler for author clicks to make re-attaching easier
    function handleAuthorClick() {
        const author = this.getAttribute('data-author');
        const sentiment = this.getAttribute('data-sentiment');
        showAuthorMessagesModal(author, sentiment);
    }

    // --- Main UI Update Function: updateDashboard ---
    // This function receives new data from the backend and updates all UI elements.
    function updateDashboard(data) {
        // Update the last message ID received
        lastMessageIdReceived = data.last_message_id;

        // Update general metrics (these always reflect total counts from the backend)
        totalMessagesElement.textContent = data.total_messages_count;
        positiveMessagesElement.textContent = data.positive_messages_count;
        negativeMessagesElement.textContent = data.negative_messages_count;
        neutralMessagesElement.textContent = data.neutral_messages_count;

        // Update chart data
        sentimentChart.data.datasets[0].data = [
            data.positive_messages_count,
            data.negative_messages_count,
            data.neutral_messages_count
        ];
        sentimentChart.update();

        // Process only NEW messages and append them
        if (data.messages && data.messages.length > 0) {
            // Remove "No messages" placeholder if it exists
            const noMessagesPlaceholder = liveChatFeed.querySelector('.no-messages');
            if (noMessagesPlaceholder) {
                noMessagesPlaceholder.remove();
            }

            data.messages.forEach(msg => {
                processAndDisplayMessage(msg); // This now appends to liveChatFeed AND updates allMessagesStore
            });
            // Auto-scroll to the "bottom" (visually, top of the reversed column)
            liveChatFeed.scrollTop = 0;
        }

        // Rebuild prominent authors lists from the *accumulated* allMessagesStore
        updateAuthorLists();

        // Update last updated timestamp
        lastUpdateElement.textContent = new Date().toLocaleTimeString();
    }

    // Function to reset all frontend data when stream stops or error occurs
    function resetFrontendData() {
        lastMessageIdReceived = 0; // Reset message ID for a fresh start
        liveChatFeed.innerHTML = '<p class="no-messages text-gray-600 text-center py-10 text-xl">Enter a YouTube Live Video URL to begin monitoring the chat.</p>';
        
        // Explicitly clear the local message store
        allMessagesStore.negative = {};
        allMessagesStore.positive = {};
        allMessagesStore.neutral = {};

        // Reset all counts to zero
        totalMessagesElement.textContent = '0';
        positiveMessagesElement.textContent = '0';
        negativeMessagesElement.textContent = '0';
        neutralMessagesElement.textContent = '0';

        // Reset chart
        sentimentChart.data.datasets[0].data = [0, 0, 0];
        sentimentChart.update();

        updateAuthorLists(); // This will clear the lists and put back placeholders
        lastUpdateElement.textContent = 'N/A';
    }

    // --- Data Fetching Function ---
    async function fetchLiveData() {
        try {
            const response = await fetch('/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                // Send the lastMessageIdReceived to the backend
                body: JSON.stringify({ action: 'get_live_data', last_message_id: lastMessageIdReceived })
            });
            const data = await response.json();
            updateDashboard(data); // This now handles appending new messages

            // Update the scraping status based on the backend's `is_active` flag
            updateScrapingStatus(data.is_active, data.current_url);

            // If scraping stopped on the backend (e.g., due to stream ending or error), clear the interval
            if (!data.is_active && fetchIntervalId) {
                clearInterval(fetchIntervalId);
                fetchIntervalId = null;
                console.log("Scraping stopped, cleared fetch interval.");
                resetFrontendData(); // Clear frontend data when scraping explicitly stops or crashes
            }
        } catch (error) {
            console.error('Error fetching live data:', error);
            // If there's an error fetching, assume scraping might have stopped or failed
            updateScrapingStatus(false, "");
            if (fetchIntervalId) {
                clearInterval(fetchIntervalId);
                fetchIntervalId = null;
            }
            resetFrontendData(); // Clear frontend data on fetch error, assuming scraping might have stopped
        }
    }

    // --- Event Listeners ---

    startButton.addEventListener('click', async function() {
        const videoUrl = videoUrlInput.value.trim();
        if (!videoUrl) {
            alert('Please enter a YouTube Live URL.');
            return;
        }

        startButton.disabled = true;
        console.log('Attempting to start scraping for:', videoUrl);
        try {
            const response = await fetch('/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action: 'start_scrape', video_url: videoUrl })
            });
            const result = await response.json();
            alert(result.status);
            if (result.status.startsWith("Scraping started.") || result.status.startsWith("Scraping is already active")) {
                if (fetchIntervalId) {
                    clearInterval(fetchIntervalId);
                }
                resetFrontendData(); // Always clear frontend data for a completely fresh start when starting new scrape
                fetchIntervalId = setInterval(fetchLiveData, 2000); // Start fetching new data
                fetchLiveData(); // Initial fetch immediately to get current status and data
            } else {
                startButton.disabled = false;
            }
        } catch (error) {
            console.error('Error starting scrape:', error);
            alert('Failed to start scraping. Check console for details.');
            startButton.disabled = false;
        }
    });

    stopButton.addEventListener('click', async function() {
        stopButton.disabled = true;
        console.log('Attempting to stop scraping...');
        try {
            const response = await fetch('/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action: 'stop_scrape' })
            });
            const result = await response.json();
            alert(result.status);
            if (result.status === "Scraping stopped.") {
                if (fetchIntervalId) {
                    clearInterval(fetchIntervalId);
                    fetchIntervalId = null;
                }
                resetFrontendData(); // Clear frontend data after successful stop
                updateScrapingStatus(false);
            } else {
                stopButton.disabled = false;
            }
        } catch (error) {
            console.error('Error stopping scrape:', error);
            alert('Failed to stop scraping. Check console for details.');
            stopButton.disabled = false;
            resetFrontendData(); // Clear on error during stop as well
        }
    });

    downloadNegativeAuthorsBtn.addEventListener('click', () => generateAndDownloadAuthorMessages('negative'));
    downloadPositiveAuthorsBtn.addEventListener('click', () => generateAndDownloadAuthorMessages('positive'));

    // Modal event listeners
    closeModalBtn.addEventListener('click', hideAuthorMessagesModal);
    authorMessagesModal.addEventListener('click', function(event) {
        if (event.target === authorMessagesModal) { // Close if clicked outside the modal content
            hideAuthorMessagesModal();
        }
    });
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && !authorMessagesModal.classList.contains('hidden')) {
            hideAuthorMessagesModal();
        }
    });

    // --- Initial Load ---
    // Fetch live data once when the page loads to set the initial status
    fetchLiveData();
});