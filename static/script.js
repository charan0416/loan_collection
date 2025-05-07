// Get references to UI elements
const startButton = document.getElementById('startRecognition');
const stopButton = document.getElementById('stopRecognition');
const findCustomerButton = document.getElementById('findCustomerButton');
const statusDiv = document.getElementById('status');
const transcriptDiv = document.getElementById('transcript'); // Where recognition transcript appears temporarily
const chatbox = document.getElementById('chatbox'); // The main message display area
const customerNameInput = document.getElementById('customerNameInput');

// Element for audio feedback during bot speech (optional, but helpful UI)
const audioFeedbackDiv = document.createElement('div');
audioFeedbackDiv.id = 'audio-feedback';
audioFeedbackDiv.style.cssText = 'font-style: italic; color: #555; margin-top: 5px; min-height: 1em;';
// Insert this element into the page's DOM structure (e.g., after the chatbox)
// Using insertBefore on the parent node
if (chatbox && chatbox.parentNode) {
    chatbox.parentNode.insertBefore(audioFeedbackDiv, chatbox.nextSibling); // Insert after chatbox
} else {
    console.error("Chatbox or its parent not found, cannot insert audio feedback div.");
}


// Variables for state management
let recognition; // Web Speech Recognition object
let isRecognizing = false; // Flag to indicate if speech recognition is active
let currentFinalTranscript = ''; // Accumulates final transcript for a single user turn


// --- Feature detection for Web Speech API support ---
// Use both standard and prefixed checks for broader browser compatibility
const hasSpeechRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
const hasSpeechSynthesis = 'speechSynthesis' in window;

// --- Configure Web Speech Recognition if supported ---
if (!hasSpeechRecognition) {
     console.warn("Speech Recognition not supported in this browser. Voice input unavailable.");
     // Hide voice controls and related elements if not supported
     startButton.style.display = 'none';
     stopButton.style.display = 'none';
     transcriptDiv.style.display = 'none'; // Hide transcript display
     statusDiv.textContent = 'Status: Voice input not supported. Please use text input below.';
     // Keep text input elements enabled by default (defined in HTML), or handle them for text-only chat below.
     // The `resetStateAfterTurn` function will correctly enable text input if hasSpeechRecognition is false.
     if (audioFeedbackDiv) audioFeedbackDiv.style.display = 'none'; // Hide audio feedback as well

} else {
    console.info(`Speech Recognition supported (${'SpeechRecognition' in window ? 'SpeechRecognition' : 'webkitSpeechRecognition'}' found). Initializing...`);
    // Get the appropriate SpeechRecognition object constructor
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();

    // Configure the recognition properties
    recognition.continuous = false; // Stop recognition automatically after a detected pause in speech
    recognition.interimResults = true; // Provide results as user speaks, before they are finalized
    recognition.lang = 'en-US'; // Set the language for recognition

    // --- Event Handlers for Speech Recognition ---
    // These functions handle different stages of the speech recognition lifecycle
    recognition.onstart = () => {
        console.log("Recognition started event fired."); // Debugging
        isRecognizing = true;
        statusDiv.textContent = 'Status: Listening... Please speak clearly.';
        startButton.disabled = true; // Disable start button while recognition is active
        stopButton.disabled = false; // Enable stop button to allow manual stop
        transcriptDiv.textContent = 'Say something...'; // Placeholder text in the transcript area
        currentFinalTranscript = ''; // Clear the accumulated transcript for this new session turn
         if (audioFeedbackDiv) audioFeedbackDiv.textContent = ''; // Clear any old audio feedback status

        // Optional: Play a sound/beep to signal listening has started
    };

    recognition.onresult = (event) => {
        console.log("Recognition onresult event fired. Processing results...", event.results); // Debugging: Log the event object to inspect results

        let interimTranscript = ''; // Stores speech that hasn't been finalized yet
        let eventFinalTranscript = ''; // Stores the finalized part of the current result set from the API

        // Loop through all results provided in this 'onresult' event
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            // Check if the current result is a final transcript segment
            if (event.results[i].isFinal) {
                // Concatenate the text from this final segment
                eventFinalTranscript += event.results[i][0].transcript;
                 console.log("Recognition: Captured FINAL result piece:", event.results[i][0].transcript); // Debugging
            } else {
                // Concatenate the text from this interim segment
                interimTranscript += event.results[i][0].transcript;
                 console.log("Recognition: Captured INTERIM result piece:", event.results[i][0].transcript); // Debugging
            }
        }

        // **Accumulate the final transcript across potentially multiple `onresult` events within one recognition session**
        // Some browsers might fire `onresult` with `isFinal: true` multiple times before `onend`.
        currentFinalTranscript += eventFinalTranscript;

        // **Update the `transcriptDiv` immediately** to show the user what's being recognized in near real-time
        // Display the current interim text concatenated with the *total accumulated* final text so far.
        transcriptDiv.textContent = interimTranscript + currentFinalTranscript;

        if (eventFinalTranscript) {
             console.log("Recognition: Updated total accumulated final transcript to:", currentFinalTranscript); // Debugging
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition onerror:', event.error); // Debugging: Log the specific error

        let errorText = 'Speech input error occurred.';
        // Provide user-friendly messages for common error types
        if (event.error === 'no-speech') {
            errorText = 'No speech detected. Please try speaking louder or after the beep.';
            console.warn("Speech recognition error: no-speech"); // Debugging
        } else if (event.error === 'audio-capture') {
             errorText = 'Microphone access error. Please check your microphone.';
              console.error("Speech recognition error: audio-capture"); // Debugging
         } else if (event.error === 'not-allowed') {
             errorText = 'Microphone permission was denied. Please allow access in browser settings and reload.';
              console.error("Speech recognition error: not-allowed"); // Debugging Permission is a critical, often unrecoverable error in this session. Guide user and disable features.
              statusDiv.textContent = `Status: ${errorText}`;
              // Completely disable voice features if permission denied
              customerNameInput.disabled = false; // Keep text input usable
              findCustomerButton.disabled = false; // Keep find usable
              startButton.style.display = 'none'; // Hide the start button as it won't work
              stopButton.style.display = 'none'; // Hide the stop button
              transcriptDiv.style.display = 'none'; // Hide transcript display
              currentFinalTranscript = ''; // Clear accumulated transcript on critical error
              if (audioFeedbackDiv) audioFeedbackDiv.style.display = 'none'; // Hide feedback
              return; // Cannot reset normally after this error, the feature is blocked
         } else {
              errorText = `Recognition error: ${event.error}`; // Include the specific error type for less common issues
               console.error(`Speech recognition unknown error: ${event.error}`); // Debugging
         }

        statusDiv.textContent = `Status: ${errorText}`; // Display the specific error message to the user

        // Reset recognizing state and UI after any type of recognition error (except not-allowed handled above)
         isRecognizing = false; // Recognition is no longer active
         stopButton.disabled = true; // Stop button not needed as session is over
         transcriptDiv.textContent = ''; // Clear any residual transcript display
         currentFinalTranscript = ''; // Clear accumulated transcript on error

         if (audioFeedbackDiv) audioFeedbackDiv.textContent = ''; // Clear audio feedback indicator

         // Reset button states (will re-enable Start/Find based on if customer was found)
         setTimeout(resetStateAfterTurn, 500); // Use a timeout to ensure visual state update
    };

    // The `onend` event signifies that the speech recognition service has stopped
    // and will not be providing any more results (either due to pause, manual stop, or error).
    recognition.onend = () => {
        console.log("Recognition onend event fired."); // Debugging

        isRecognizing = false; // Recognition session is now completely ended
        stopButton.disabled = true; // Stop button is not active after session end
         if (audioFeedbackDiv) audioFeedbackDiv.textContent = ''; // Ensure audio feedback indicator is clear


         // Get the final, accumulated transcript collected in the onresult handlers.
         const finalTranscriptToSend = currentFinalTranscript.trim(); // Use the accumulated variable, trim whitespace
         currentFinalTranscript = ''; // **CRITICAL:** Reset accumulator for the next recognition turn!
         transcriptDiv.textContent = ''; // Clear the transcript display as processing begins

         // Check if a non-empty final transcript was actually captured during this session
         if (finalTranscriptToSend) {
            console.log("Recognition ended. Processing final transcript:", finalTranscriptToSend); // Debugging: Log the actual text being sent
            // **Trigger the processing of the user's input by calling the backend function**
            processUserInput(finalTranscriptToSend);
         } else {
             console.warn("Recognition ended with no usable transcript captured during the session."); // Debugging
             // Inform the user if no speech was captured and reset UI state.
             statusDiv.textContent = 'Status: No speech captured or understood. Please try again.';
             resetStateAfterTurn(); // Reset UI (enables appropriate button for next turn)
         }
    };


    // --- Event Listeners for Voice Buttons ---
    startButton.addEventListener('click', () => {
        console.log("Start button clicked. isRecognizing:", isRecognizing, "button disabled:", startButton.disabled); // Debugging
        // Only start if not already recognizing and the button is currently enabled (should be true if customer found)
        if (!isRecognizing && !startButton.disabled) {
             statusDiv.textContent = 'Status: Starting speech recognition...';
             // Use a small timeout before calling recognition.start() - can help improve initial capture and prevent immediate 'no-speech' on some systems.
             setTimeout(() => {
                try {
                    console.log("Calling recognition.start()."); // Debugging: Attempt to start recognition API
                    recognition.start(); // This will trigger the 'onstart' event if successful
                } catch (e) {
                     console.error("Error calling recognition.start():", e); // Debugging: Catch potential errors starting the API
                     statusDiv.textContent = `Status: Error starting microphone (${e.message}). Please try again and check browser permissions.`;
                      // Reset button state immediately if starting failed
                     isRecognizing = false;
                     startButton.disabled = false; // Re-enable start button to retry
                     stopButton.disabled = true;
                     transcriptDiv.textContent = ''; // Clear any text
                }
             }, 100); // 100ms delay

        } else {
             console.warn("Start button clicked but ignored (already recognizing or button is disabled)."); // Debugging
        }
    });

    stopButton.addEventListener('click', () => {
        console.log("Stop button clicked. isRecognizing:", isRecognizing); // Debugging
        // Only allow stopping if recognition is currently active
        if (isRecognizing) {
             statusDiv.textContent = 'Status: Stopping recognition...';
             console.log("Calling recognition.stop()."); // Debugging: Request recognition to stop
            recognition.stop(); // This will trigger the 'onend' event shortly after
        } else {
            console.warn("Stop button clicked but recognition not in progress."); // Debugging
        }
    });
}


// --- Event Listener for Text Input Button/Enter Key ---
// This listener is attached to the customerNameInput field. It determines if Enter/Click
// should perform a lookup OR send a chat message based on the UI state.
findCustomerButton.addEventListener('click', handleCustomerLookup); // Find button always triggers lookup directly

// Keypress listener for the customer name input field
customerNameInput.addEventListener('keypress', function(event) {
    // Only act if the pressed key is 'Enter'
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent the browser's default form submission behavior

        console.log("Enter key pressed in customer name input."); // Debugging

        // Determine the action based on the visibility and state of the findCustomerButton.
        // If findCustomerButton is visible and enabled, it implies we are in the initial lookup phase.
        // If findCustomerButton is NOT visible, it implies we are in the chat phase (either voice or text).
        if (findCustomerButton.style.display !== 'none' && !findCustomerButton.disabled) {
            console.log("Action: Triggering customer lookup (Enter key in lookup mode)."); // Debugging
             handleCustomerLookup(); // Call the lookup function
        } else if (!customerNameInput.disabled) { // If the input is enabled AND find button isn't visible -> Text Chat Mode
             console.log("Action: Triggering text chat message (Enter key in text chat mode)."); // Debugging
             handleTextChatEnter(); // Call the text chat handling function
         } else {
              console.log("Action: Enter key ignored (input is disabled)."); // Debugging - System is processing
         }
    }
});


// --- Function to Handle Customer Lookup ---
// Initiates the request to the backend to find a customer by name.
async function handleCustomerLookup() {
     const name = customerNameInput.value.trim();
     if (name === '') {
         appendMessage('Collector', "Please enter the customer's name first.");
         console.warn("handleCustomerLookup called with empty name input."); // Debugging
         return; // Stop if input is empty
     }

    // Disable input elements while the lookup request is in progress to prevent multiple submissions.
     customerNameInput.disabled = true;
     findCustomerButton.disabled = true;
     // Voice buttons are off during lookup as well.
     if (hasSpeechRecognition) { // Only try to disable if voice is even a possibility
        startButton.disabled = true;
        stopButton.disabled = true;
     }


     statusDiv.textContent = `Status: Looking up loan for "${name}"...`; // Update status on the page
     console.log(`Sending lookup request for "${name}" to /find_customer.`); // Debugging: Log the fetch request
     chatbox.scrollTop = chatbox.scrollHeight; // Auto-scroll the chatbox to ensure the status message is visible


     try {
        // Send the customer name to the backend's /find_customer endpoint
        const response = await fetch('/find_customer', {
            method: 'POST', // Use POST as designed in app.py
            headers: {
                'Content-Type': 'application/json', // Specify the request body format
            },
            body: JSON.stringify({ customer_name: name }), // Send the name as JSON in the request body
        });

        // Always check for non-OK HTTP response statuses (like 400, 500 errors)
        if (!response.ok) {
             console.error('HTTP error during customer lookup fetch:', response.status, response.statusText); // Debugging: Log the HTTP error
             const errorBody = await response.text(); // Attempt to get the response body for more details
             console.error('Response body:', errorBody); // Debugging: Log the error response body

             appendMessage('Collector', `Server error during lookup (${response.status}). Please check backend terminal for details.`);
             statusDiv.textContent = 'Status: Lookup failed due to server error. Try again.';
             // Re-enable input for another attempt after a server error
             customerNameInput.disabled = false;
             findCustomerButton.disabled = false;
              if (hasSpeechRecognition) {
                  startButton.disabled = true;
                  stopButton.disabled = true;
              }

        } else {
            // Process the successful HTTP response (status 200)
            const data = await response.json(); // Parse the JSON response body
            console.log('/find_customer fetch successful. Received data:', data); // Debugging: Log the parsed JSON data
            appendMessage('Collector', data.response); // Display the backend's response message to the user (e.g., "found", "not found")

             if (data.customer_found) {
                 console.info('handleCustomerLookup: Customer successfully found! Transitioning to chat mode UI.'); // Debugging
                 // Customer found successfully - update UI state to chat mode
                 statusDiv.textContent = hasSpeechRecognition ?
                     'Status: Customer found. Click "Start Talking (Voice)" to speak to the collector.' :
                     'Status: Customer found. Ready for text chat.'; // Update status based on voice capability

                 // **Update UI state: Disable/Hide lookup specific controls**
                  customerNameInput.disabled = true; // Name input is no longer used for lookups
                  findCustomerButton.style.display = 'none'; // Hide the find button
                  findCustomerButton.disabled = true; // Ensure disabled state

                 // **Enable the appropriate chat input method (Voice OR Text) based on capability**
                 if (hasSpeechRecognition) {
                     console.log("handleCustomerLookup: Voice enabled."); // Debugging
                    startButton.disabled = false; // ENABLE the voice start button
                    stopButton.disabled = true; // Stop is initially disabled until recording starts
                 } else {
                      console.log("handleCustomerLookup: Voice not supported. Enabling text chat input."); // Debugging
                     // If voice is not supported, enable the text input box for typing chat messages
                     customerNameInput.disabled = false; // Re-enable the customer name input field
                     customerNameInput.placeholder = "Type your message and press Enter..."; // Change placeholder text
                 }
             } else {
                 console.warn('handleCustomerLookup: Backend reported customer not found.'); // Debugging: Backend processed request but didn't find a match
                 // Displayed "not found" message to the user via appendMessage already.
                 statusDiv.textContent = data.response && data.response.startsWith("I couldn't find") ?
                                         'Status: Customer not found. Ready for name lookup.' : // Specific "not found" status
                                         'Status: Lookup completed. Try again.'; // General failed lookup status

                 // **Reset UI state for another lookup attempt** - Re-enable name input and Find button
                  customerNameInput.disabled = false;
                  findCustomerButton.disabled = false;
                  // Voice buttons remain disabled in this state
                   if (hasSpeechRecognition) {
                       startButton.disabled = true;
                       stopButton.disabled = true;
                   }
             }
         }
         chatbox.scrollTop = chatbox.scrollHeight; // Auto-scroll after message
     } catch (error) {
         // Handle network errors that prevent the fetch request from completing
         console.error('Network Error during customer lookup fetch:', error); // Debugging: Log the network error details
         appendMessage('Collector', "A network error occurred during lookup. Please ensure the backend server is running on port 8000.");
         statusDiv.textContent = 'Status: Network error during lookup. Try again.';
          // Re-enable input for another attempt after a network error
         customerNameInput.disabled = false;
         findCustomerButton.disabled = false;
          if (hasSpeechRecognition) {
             startButton.disabled = true;
             stopButton.disabled = true;
         }
         chatbox.scrollTop = chatbox.scrollHeight; // Auto-scroll
     }
}


// --- Handler for text input messages (used when voice is not supported) ---
// This function is called by the keypress listener on customerNameInput
// ONLY when a customer has been found AND hasSpeechRecognition is false.
async function handleTextChatEnter() {
    const text = customerNameInput.value.trim();
    // Don't send empty messages
    if (!text) {
        console.warn("handleTextChatEnter called with empty text. Ignoring."); // Debugging
        // Optionally provide feedback to the user
        // statusDiv.textContent = 'Status: Please type a message.';
        return;
    }

    console.log("handleTextChatEnter: Processing text chat message:", text); // Debugging: Log the text being processed

    // Call the function to send the text input to the backend's /chat endpoint
    processUserInput(text);

    // Clear the text input field immediately after sending the message
    customerNameInput.value = ''; // This will be re-enabled in processUserInput's finally block for the next turn
}


// --- Asynchronous function to send user input to the backend and handle response ---
// This is called by recognition.onend (for voice) or handleTextChatEnter (for text fallback)
async function processUserInput(text) {
     // Final check for empty text after potential processing/trimming in handlers
     if (!text || text.trim() === "") {
        console.warn("processUserInput called with empty or whitespace text after trim. Ignoring."); // Debugging
        statusDiv.textContent = 'Status: Empty input ignored. Ready for next turn.';
        // Since no request was sent, just reset UI state based on where we should be (customer found or not)
        resetStateAfterTurn();
        return; // Stop execution for this turn
    }
    // Add the user's input message to the chatbox display
    appendMessage('You', text);

    console.log(`processUserInput: Sending user input to /chat: "${text}"`); // Debugging: Log the input being sent to backend
    statusDiv.textContent = 'Status: Processing response...'; // Update status on the page

    // Disable inputs while the backend is processing the request.
     customerNameInput.disabled = true;
     // findCustomerButton is already hidden/disabled if in chat mode
     startButton.disabled = true; // Disable voice start button during processing
     stopButton.disabled = true; // Disable voice stop button during processing


    try {
        console.log("Calling fetch request to /chat."); // Debugging
        // Send the user's input text to the backend's /chat endpoint
        const response = await fetch('/chat', {
            method: 'POST', // Use POST
            headers: {
                'Content-Type': 'application/json', // Specify JSON body
            },
            body: JSON.stringify({ text: text }), // Send user text in JSON format
        });

         // Check for non-OK HTTP response status codes
        if (!response.ok) {
             console.error('HTTP error during /chat fetch:', response.status); // Debugging: Log the HTTP status error
             const errorBody = await response.text(); // Attempt to get response body for more detail
             console.error('Response body:', errorBody); // Debugging: Log error response body

             // Display a generic error message to the user
             appendMessage('Collector', `Server error during chat (${response.status}). Please check backend terminal.`);
             // Provide a fallback speech response if TTS is available
             const fallbackMessage = "Sorry, I encountered an issue on my end. We can try again in a moment regarding your loan.";
             if (hasSpeechSynthesis) { speakResponse(fallbackMessage); } // This function calls speechSynthesis.speak

             statusDiv.textContent = 'Status: Chat failed due to server error.'; // Update status message on the page
         } else {
             // Process successful HTTP response (status 200)
             const data = await response.json(); // Parse the JSON response body
             console.log("/chat fetch successful. Received data:", data); // Debugging: Log the parsed JSON data

            const collectorResponse = data.response; // Extract the bot's response text
            appendMessage('Collector', collectorResponse); // Add the bot's response to the chatbox

            // Use speech synthesis only if it is available in the browser
            if (hasSpeechSynthesis) {
                 console.log("Attempting to speak collector response."); // Debugging
                 if (audioFeedbackDiv) audioFeedbackDiv.textContent = '(Speaking...)'; // Show speaking indicator
                 // Call the speakResponse function to synthesize and play the audio
                 // Adding a small delay before speaking can help ensure voices are ready and prevent cutoffs
                 setTimeout(() => {
                      speakResponse(collectorResponse); // This function internally calls window.speechSynthesis.speak
                 }, 200); // 200ms delay
            } else {
                 console.info("Speech synthesis not available. Skipping speech output."); // Debugging
                 // In text chat mode, the next input field is enabled by the resetStateAfterTurn function in the 'finally' block.
            }
             statusDiv.textContent = 'Status: Response received. Ready for next turn.'; // Update status on the page
         }


    } catch (error) {
        // Handle network errors that prevent the fetch request to /chat from even starting or completing.
        console.error('Network Error communicating with backend /chat:', error); // Debugging: Log the network error details
        const errorMessage = "Sorry, I'm having trouble connecting to the server right now. Please ensure the backend is running on port 8000.";
        appendMessage('Collector', errorMessage); // Display network error message in chatbox
         if (hasSpeechSynthesis) { speakResponse(errorMessage); } // Speak network error message if supported
         statusDiv.textContent = 'Status: Network error during chat. Try again.'; // Update status on the page
    } finally {
       // --- Reset Button/Input State ---
       console.log("processUserInput finally block called. Resetting UI state."); // Debugging
       // The resetStateAfterTurn function determines which inputs/buttons should be enabled
       // based on the application's current state (customer found + voice supported vs. text chat mode).
       // The enablement of the VOICE START button *after* the collector finishes speaking is handled
       // asynchronously by the `utterance.onend` event listener within the `speakResponse` function.
       resetStateAfterTurn(); // Call the UI state reset function

       // Scroll to the bottom automatically to show the latest message(s)
       chatbox.scrollTop = chatbox.scrollHeight;
       console.debug("Chatbox scrolled to bottom in finally block."); // Debugging

       // Clear any lingering audio feedback status.
       if (audioFeedbackDiv) audioFeedbackDiv.textContent = ''; // Ensure feedback is cleared here too, even if speech was skipped/errored.
    }
}


// --- Text to Speech Setup ---
// Handles synthesizing text and playing it as audio using the browser's Speech Synthesis API.
function speakResponse(text) {
    // Check if Speech Synthesis is available and the text to speak is not empty
    if (!hasSpeechSynthesis || text.trim() === "") {
         console.warn("speakResponse called, but SpeechSynthesis not available or text is empty. Skipping speech."); // Debugging
         if (audioFeedbackDiv) audioFeedbackDiv.textContent = ''; // Clear feedback if speech skipped
         // Manually trigger start button re-enablement if in voice chat mode, as onend won't fire
          if (findCustomerButton.style.display === 'none' && hasSpeechRecognition) {
              startButton.disabled = false;
               console.log("TTS skipped. Enabling Start Talking button as speech did not play."); // Debugging
          }
         return; // Exit if conditions not met
     }

    console.log(`Speaking response: "${text}"`); // Debugging: Log the text being spoken

    // Cancel any currently ongoing speech to avoid voices overlapping
    if (window.speechSynthesis.speaking) {
         console.log("Cancelling previous speech before speaking new response."); // Debugging
        window.speechSynthesis.cancel();
    }

    // Create a new SpeechSynthesisUtterance object for the text
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US'; // Set the language for synthesis

     // Optional: Try to get a preferred voice from the available voices list.
    const voices = window.speechSynthesis.getVoices(); // Get the list of available voices
    if (voices.length > 0) {
        // Prioritize the default voice, then any US English voice, fall back to the first available voice.
        utterance.voice = voices.find(v => v.default) || voices.find(v => v.lang.startsWith('en-US')) || voices[0];
         console.log("speakResponse: Selected voice:", utterance.voice ? utterance.voice.name : "Default/First"); // Debugging
    } else {
         console.warn("speakResponse: No voices available yet when trying to speak. Using default."); // Debugging - May resolve when voiceschanged fires
    }

    // Set standard speech rate and pitch for clarity.
    utterance.rate = 1.0; // Normal speed
    utterance.pitch = 1.0; // Normal pitch

     // --- Add event listeners to the utterance to track speech progress ---
    // These events are crucial for controlling the UI based on when the bot is speaking vs. when it's the user's turn.
    utterance.onstart = () => { console.log("Speech started event."); if (audioFeedbackDiv) audioFeedbackDiv.textContent = '(Speaking...)'; }; // Indicate speech is starting/active

    // This event fires when the speech synthesis has finished speaking the utterance.
    utterance.onend = () => {
        console.log("Speech ended event."); // Debugging
        if (audioFeedbackDiv) audioFeedbackDiv.textContent = ''; // Clear the speaking indicator

        // **After the collector finishes speaking**, if the user is in voice chat mode (customer found AND has speech capability),
        // **re-enable the start button** to signal that it's now their turn to speak.
        // We check if the 'Find Customer' button is hidden as the indicator for 'customer found'.
        if (findCustomerButton && findCustomerButton.style.display === 'none' && hasSpeechRecognition) {
             startButton.disabled = false; // ENABLE the Start Talking button for the next user turn
              console.log("Speech ended. Enabling Start Talking button for next user input turn."); // Debugging
         } else {
             console.log("Speech ended. Not in voice chat mode, or voice not supported. Start button not enabled by onend."); // Debugging
             // If text chat, input is re-enabled in resetStateAfterTurn's finally block
         }
    };

    // This event fires if there is an error during speech synthesis.
    utterance.onerror = (event) => {
         console.error("SpeechSynthesis Utterance Error:", event.error); // Debugging: Log the specific synthesis error
         if (audioFeedbackDiv) audioFeedbackDiv.textContent = '(Speech error)'; // Indicate there was an error speaking

          // Even if there was a speech error, we should still allow the user to speak their next turn
          // by re-enabling the start button if appropriate (voice chat mode).
          if (findCustomerButton && findCustomerButton.style.display === 'none' && hasSpeechRecognition) {
              startButton.disabled = false;
               console.log("Speech error. Enabling Start Talking button for next turn despite error."); // Debugging
          } else {
               console.log("Speech error. Not in voice chat mode, or voice not supported. Start button not enabled by onerror."); // Debugging
          }
    };

    // **Start the speech synthesis process**
    window.speechSynthesis.speak(utterance);
}

// Ensure voices are loaded for TTS. This event can fire multiple times as voices are loaded.
if (hasSpeechSynthesis) {
    console.log("SpeechSynthesis: Adding onvoiceschanged listener."); // Debugging
    window.speechSynthesis.onvoiceschanged = function() {
       const voices = window.speechSynthesis.getVoices();
       console.log(`SpeechSynthesis: Voices changed/loaded. Available voices count: ${voices.length}`); // Debugging
       // After voices are loaded, you *could* re-attempt to speak the initial greeting here if it failed previously
       // or update the UI to show voice capability is fully ready.
       // For simplicity now, just logging.
    };
} else {
     console.warn("SpeechSynthesis not supported in this browser. Audio feedback hidden."); // Debugging
     // If speech synthesis is not supported, hide the audio feedback element.
     if (audioFeedbackDiv) audioFeedbackDiv.style.display = 'none';
}


// --- Utility Functions ---

// Resets the state of input fields and buttons based on whether a customer has been found
// and whether voice input is supported. Called at the end of processing each user turn.
function resetStateAfterTurn() {
     console.log("resetStateAfterTurn called."); // Debugging
    // The stop button should never be active after a turn completes.
    stopButton.disabled = true;

    // Check if the 'Find Customer' button is hidden. This is our primary indicator
    // that a customer has been successfully found for this session.
     if (findCustomerButton && findCustomerButton.style.display === 'none') { // Scenario: Customer found
         console.log("resetStateAfterTurn: Customer found state detected."); // Debugging

         // Determine if we should use Voice Chat mode or Text Chat mode based on feature detection
         if (hasSpeechRecognition) {
              console.log("resetStateAfterTurn: Voice chat mode."); // Debugging
              // **Voice Chat Mode:**
              // The START button is ENABLED asynchronously by the `utterance.onend`/`onerror` event handlers *after the bot finishes speaking*.
              // So, we just set the status and ensure inputs related to lookup/typing are off.
              statusDiv.textContent = 'Status: Response received.'; // Response processed status.
              // customerNameInput is already disabled permanently in handleCustomerLookup after finding the customer.
              // findCustomerButton is hidden/disabled.

              console.log("resetStateAfterTurn: Waiting for collector speech to end before enabling Start Talking button."); // Debugging
         } else {
              console.log("resetStateAfterTurn: Text chat mode (Voice not supported)."); // Debugging
              // **Text Chat Mode (Voice Unsupported):**
              // Re-enable the text input field so the user can type their next message.
              customerNameInput.disabled = false; // Re-enable text input field for typing.
               statusDiv.textContent = 'Status: Ready for next text input.'; // Update status to prompt user
              console.log("resetStateAfterTurn: Re-enabling text input for next message."); // Debugging
              // findCustomerButton remains hidden/disabled
         }
     } else { // Scenario: Initial state or customer not found/lookup failed
         console.log("resetStateAfterTurn: Lookup state or customer not found detected."); // Debugging

         // Re-enable inputs/buttons related to the initial name lookup.
         customerNameInput.disabled = false; // Enable text input for name entry.
         findCustomerButton.disabled = false; // Enable the Find Customer button.

         // Voice buttons are disabled in this state until a customer is found.
          startButton.disabled = true;
          stopButton.disabled = true;

         statusDiv.textContent = 'Status: Ready for customer name lookup.'; // Set status message for the user.
         console.log("resetStateAfterTurn: Reset to lookup state."); // Debugging
     }
     // Ensure the transcript display area is cleared for the next turn's speech (handled by onend/onerror).
     // audioFeedbackDiv is cleared by speakResponse event handlers.
}


// --- Initial setup when the page loads ---
// This runs once when the browser fully loads the page content.
window.addEventListener('load', () => {
     console.info("Window loaded. Initializing UI state and greeting."); // Debugging

    // Set the initial state of UI elements when the page loads.
    // Only the name input and 'Find Customer' button should be interactive initially.
    customerNameInput.disabled = false; // Name input is the starting point
    findCustomerButton.disabled = false; // Find button triggers the first step
    startButton.disabled = true; // Voice start button is disabled until a customer is found
    stopButton.disabled = true; // Voice stop button is disabled initially

    statusDiv.textContent = 'Status: Enter customer name to begin.'; // Set the initial status message for the user

     // Attempt to speak the initial greeting message.
     // Using a timeout gives the browser some time to load necessary resources (like voices).
     setTimeout(() => {
          speakInitialGreeting(); // Call the function to speak the greeting
     }, 500); // 500ms delay before speaking


     console.log("Window load process initiated. UI state and greeting queued."); // Debugging
});


// Function to read the initial greeting text from the HTML and speak it (if supported).
// This helps orient the user when they first open the page.
function speakInitialGreeting() {
    // Check if speech synthesis is available in the browser before attempting to speak.
    if (!hasSpeechSynthesis) {
        console.info("Speech synthesis not available. Skipping initial greeting speech."); // Debugging
        // Hide the audio feedback indicator if speech output isn't possible.
        if (audioFeedbackDiv) audioFeedbackDiv.style.display = 'none';
        return; // Exit if speech is not supported.
    }

     // Find the specific HTML element containing the initial greeting message in the chatbox.
     const initialGreetingElement = chatbox.querySelector('.initial-greeting');
     if (initialGreetingElement) {
         // Use a simple class flag to prevent the greeting from being spoken repeatedly on events
         // like voiceschanged firing multiple times, but allow it once per page load session.
         if (!initialGreetingElement.classList.contains('spoken-in-session')) {
              // Extract the text content and remove the sender prefix ("Collector: ") for speaking.
              const textToSpeak = initialGreetingElement.textContent.replace('Collector:', '').trim();
              console.info(`Attempting to speak initial greeting text: "${textToSpeak}"`);
              // Call the speakResponse function to handle the speech synthesis.
              // speakResponse internally manages the utterance creation and speaking.
               speakResponse(textToSpeak);
              initialGreetingElement.classList.add('spoken-in-session'); // Mark this specific element as having been spoken for this session.
         } else {
              console.debug("Initial greeting already marked as spoken in this session. Skipping repeat."); // Debugging if called again after initial speak.
         }
     } else {
          console.warn("Initial greeting paragraph element with class 'initial-greeting' not found in chatbox."); // Debugging: Alert if the expected HTML element is missing.
     }
}


// Function to add a new message (either from the user or the collector bot) to the chatbox display.
// It formats the message with a sender prefix and styles it.
function appendMessage(sender, message) {
    console.log(`Appending message from ${sender}: "${message}"`); // Debugging: Log the sender and message being appended.

    // Create a new paragraph element which will hold the message text.
    const p = document.createElement('p');

    // Add a CSS class to the paragraph based on the sender (e.g., 'user' or 'collector') for styling.
    // Cleans the sender string to ensure valid class names (lowercase letters, numbers, and hyphen).
    p.classList.add(sender.toLowerCase().replace(/[^a-z0-9-]/g, ''));

    // Clean the message content to remove a redundant sender prefix if it appears at the beginning
    // This handles cases where the LLM might accidentally include "Collector: " in its output.
     let cleanedMessage = message;
     if (typeof cleanedMessage === 'string') { // Ensure the input message is a string
         cleanedMessage = cleanedMessage.trim(); // Remove leading and trailing whitespace
          const senderPrefix = `${sender.toLowerCase()}:`; // Construct the expected sender prefix format
           if (cleanedMessage.toLowerCase().startsWith(senderPrefix)) {
               // If the message starts with the sender's prefix (case-insensitive), remove it.
               cleanedMessage = cleanedMessage.substring(senderPrefix.length).trim(); // Remove prefix, trim again.
           }
     } else {
          // Handle cases where the message might not be a string as expected.
          console.warn("appendMessage received non-string message:", cleanedMessage); // Debugging: Log the unexpected type.
          cleanedMessage = String(cleanedMessage); // Coerce the message to a string to display it.
     }

    // Only append the message to the chatbox if there is actual content after cleaning.
    if (cleanedMessage) {
         p.textContent = `${sender}: ${cleanedMessage}`; // Set the cleaned message text with the sender prefix.
        chatbox.appendChild(p); // Add the newly created paragraph element to the chatbox div.

        // Remove the special 'initial-greeting' class from the *first* message once real chat messages start appearing.
        // This changes its styling from introductory to a regular collector message.
        const initialGreetingElement = chatbox.querySelector('.initial-greeting');
         if (initialGreetingElement && chatbox.children.length > 1) { // Check if the element exists and there's more than one message (including the greeting itself).
             console.log("appendMessage: Removing 'initial-greeting' class from the initial message."); // Debugging
             initialGreetingElement.classList.remove('initial-greeting');
              // Optional: You could choose to remove the entire greeting element from the DOM instead if preferred.
              // initialGreetingElement.remove();
         }

        // **Scroll the chatbox to the bottom automatically** to ensure the latest message is always visible to the user.
        chatbox.scrollTop = chatbox.scrollHeight;
        console.debug("Chatbox scrolled to bottom."); // Debugging confirmation.
    } else {
        console.warn("appendMessage: Message content became empty after cleaning or was empty initially. Not appending anything."); // Debugging: Log if nothing was appended.
    }
}