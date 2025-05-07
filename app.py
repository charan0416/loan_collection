import pandas as pd
import google.generativeai as genai
import os
import uuid
import re # Import regex for parsing overdue amount
import logging # Import logging for detailed output
import traceback # Import traceback for detailed errors
import numpy as np # Import numpy for int64 check

from flask import Flask, request, jsonify, render_template, session
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# For more detailed debug logs, uncomment:
# logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

# Get the root logger instance once
root_logger = logging.getLogger()

load_dotenv()

# --- Flask SECRET_KEY Setup (CRITICAL FOR SESSION PERSISTENCE) ---
# MUST be set CONSISTENTLY. Use environment variable in production.
# For consistent local debugging (especially with debug=True auto-reloader), use a FIXED string TEMPORARILY.
# REPLACE 'REPLACE_THIS_THIS_IS_A_DEBUG_KEY_FIX_BEFORE_PROD_!!!!' below with YOUR generated key string.
# WARNING: Do NOT use a fixed string like this in production for security. Use environment variables.
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'REPLACE_THIS_THIS_IS_A_DEBUG_KEY_FIX_BEFORE_PROD_!!!!') # <-- Use your actual fixed string here


# Log which method is being used
if 'SECRET_KEY' in os.environ:
    logging.info("Using SECRET_KEY from environment variable.")
elif isinstance(app.secret_key, str) and app.secret_key != 'REPLACE_THIS_THIS_IS_A_DEBUG_KEY_FIX_BEFORE_PROD_!!!!':
     logging.info("Using hardcoded (fixed) SECRET_KEY string.")
else:
    logging.warning("Using auto-generated/default SECRET_KEY. Session data MAY NOT persist. FIX THIS.")


# --- Configure Gemini ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    logging.error("GEMINI_API_KEY environment variable not set.")
    model = None # Set model to None
else:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        logging.info("Gemini API configured successfully.")
        # --- Initialize the Gemini Generative Model ---
        generation_config = {
          "temperature": 1.0, # Keep 1.0 for variety
          "top_p": 1.0,
          "top_k": 0,
          "max_output_tokens": 500, # Encourage conciseness
        }
        model_name = "gemini-1.5-flash-latest" # Good balance
        model = genai.GenerativeModel(model_name=model_name, generation_config=generation_config)
        logging.info(f"Gemini model '{model_name}' initialized.")
    except Exception as e:
        model = None # Set model to None if initialization fails
        logging.error(f"Failed to initialize Gemini model: {e}. Chat endpoint will not work.")


# --- Load the CSV data ---
df = None
try:
    csv_file_path = 'cleaned_data.csv'
    logging.info(f"Attempting to load CSV data from '{csv_file_path}'...")
    df = pd.read_csv(csv_file_path)

    # Pre-process numeric/int64 types for JSON serialization and handling
    numeric_cols_to_clean = ['Current Loan Amount', 'Annual Income', 'Monthly Debt',
                             'Years of Credit History', 'Months since last delinquent',
                             'Number of Open Accounts', 'Number of Credit Problems',
                             'Current Credit Balance', 'Maximum Open Credit', 'Bankruptcies', 'Tax Liens']
    for col in numeric_cols_to_clean:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce') # Convert, coerce errors to NaN
            # Convert numeric types to standard Python int/float for JSON serialization
            df[col] = df[col].apply(lambda x: x if pd.isna(x) else (int(x) if x == int(x) else float(x)))
            df[col].fillna(0.0, inplace=True) # Fill NaN with 0.0


    # Handle Credit Score
    if 'Credit Score' in df.columns:
        df['Credit Score'] = pd.to_numeric(df['Credit Score'], errors='coerce')
        df['Credit Score'] = df['Credit Score'].apply(lambda x: x / 10.0 if pd.notna(x) and x > 1000 and x < 10000 else x)
        df['Credit Score'] = df['Credit Score'].clip(lower=300.0, upper=850.0)
         # Ensure Credit Score is a standard Python int or float
        df['Credit Score'] = df['Credit Score'].apply(lambda x: x if pd.isna(x) else (int(x) if x == int(x) else float(x)))
        df['Credit Score'].fillna('Unknown Score', inplace=True)


    # Fill missing text columns
    text_cols_to_fill = ['Term', 'Years in current job', 'Home Ownership', 'Purpose', 'Random_Name', 'Random_Phone_Number']
    for col in text_cols_to_fill:
         if col in df.columns:
            df[col].fillna('Unknown', inplace=True)

    logging.info(f"CSV data loaded and pre-processed successfully from '{csv_file_path}'. DataFrame shape: (1000, 20)")

except FileNotFoundError:
    df = None
    logging.error(f"Error: The CSV file '{csv_file_path}' was not found.")
except Exception as e:
    df = None
    logging.error(f"An unexpected error occurred while processing CSV data from '{csv_file_path}': {e}")
    traceback.print_exc()


# --- Helper function to format customer data for the prompt ---
def format_customer_data_for_prompt(customer_row):
    if customer_row.empty:
        logging.warning("format_customer_data_for_prompt called with an empty customer row DataFrame.")
        return "No customer loan data available to format."

    data = customer_row.iloc[0].to_dict()

    # Convert NumPy types in dictionary to standard Python types for JSON serialization safety
    for key, value in data.items():
        if isinstance(value, (np.int64, np.float64)):
            data[key] = int(value) if value == int(value) else float(value)
        elif isinstance(value, np.bool_):
            data[key] = bool(value)

    formatted_data = f"""
--- START Customer Loan File Details for Current Call ---
Customer Name: {data.get('Random_Name', 'Unknown Customer')}
Overdue Loan Amount: ${data.get('Current Loan Amount', 0.0):,.2f}
Original Loan Term: {data.get('Term', 'Unknown Term')}
Stated Loan Purpose: {data.get('Purpose', 'Unknown')}
Home Ownership: {data.get('Home Ownership', 'Unknown')}
Monthly Debt: ${data.get('Monthly Debt', 0.0):,.2f}
Annual Income: {f'${data["Annual Income"]:,.2f}' if isinstance(data.get('Annual Income'), (int, float)) else data.get('Annual Income', 'Unknown')}
Years in Current Job: {data.get('Years in current job', 'Unknown')}
Credit Score: {data.get('Credit Score', 'Unknown Score')}
Years of Credit History: {data.get('Years of Credit History', 0.0)} years
Months Since Last Delinquent: {data.get('Months since last delinquent', 'Never reported delinquent or unknown')}
Number of Credit Problems: {data.get('Number of Credit Problems', 0)}
Number of Bankruptcies: {data.get('Bankruptcies', 0)}
Number of Tax Liens: {data.get('Tax Liens', 0)}
Current Credit Balance: ${data.get('Current Credit Balance', 0.0):,.2f}
Maximum Open Credit Available: ${data.get('Maximum Open Credit', 0.0):,.2f}
--- END Customer Loan File Details for Current Call ---
"""
    return formatted_data

# --- Define the core system instruction for the AI loan collector ---
# NOTE: Prompt significantly refined to better guide first/subsequent turns and reduce repetition.
core_system_instruction = """
You are "Apex Financial Services Representative", a highly empathetic, understanding, patient, professional, and naturally conversational representative whose SOLE job is to help customers successfully resolve their **overdue loan balance** through collaborative discussion and finding *achievable* solutions. Your interactions must be human-like, varied in phrasing, persuasive (highlighting benefits), and adapt naturally to the customer's input. NEVER be forceful, demanding, or repetitive. Your goal is to get the overdue amount paid TODAY or set up a realistic plan during THIS phone call. Be CONCISE where possible.

You MUST only respond with the **EXACT spoken lines** that the Apex Financial Services Representative would say in **THIS SINGLE turn** of the conversation. DO NOT output instructions, descriptions of tone/actions, internal thoughts, lists of scenarios, or multiple dialogue options. Your response is strictly the text to be spoken.

**Your Mission:** Engage the customer warmly and naturally to help them find a path to resolve their overdue loan situation.

**Crucial Conversational Flow & Principles:**

1.  **The VERY First Conversational Turn (Your response after the user's initial simple words like "hello" after lookup):**
    *   This is the START of the main loan discussion phone call.
    *   Your response MUST be a concise, professional opening including:
        *   Acknowledgement of their greeting and confirmation of their identity by name ([Customer Name]).
        *   Stating you are calling from Apex Financial Services regarding their overdue loan account.
        *   **CLEARLY AND MANDATORILY STATING THE SPECIFIC "Overdue Loan Amount" ($[Overdue Amount]) from their file.** This is the key financial focus for the call.
        *   A concise, supportive transition inviting them to discuss resolution today or setting up a manageable plan *right now*. Frame it as helping them find the best path *for them*.
    *   Example First Turn Lines (Pick ONE style, tailor name and amount, DO NOT list these examples or start asking about hardship here):
        *   "Hello Mr./Ms. [Customer Name], this is [Generate a plausible human name, like Alex or Jamie] from Apex Financial Services. Thanks for speaking with me today. I'm calling regarding your loan account, which currently shows an overdue balance of $[Overdue Amount]. My purpose is to help you explore how we can find the best way to take care of this amount today or arrange a manageable payment plan right now?"
        *   "Hi [Customer Name], [Generate human name] here at Apex Financial. I'm reaching out about your loan account, with an overdue balance of $[Overdue Amount]. Let's discuss setting up a payment or finding a realistic plan for that today."
        *   "Apex Financial Services, [Generate human name] speaking. Hello Mr./Ms. [Customer Name]. I'm calling about your loan account with an overdue balance of $[Overdue Amount]. Let's see if we can find a suitable option for getting this resolved or setting up an arrangement today."
    *   If the user's *first input* (after lookup) was *only* a simple greeting ("hello", "hi", "yes?"), you MUST generate this structured first turn response, filling in details from the customer file.

2.  **Subsequent Conversational Turns (Responding to Customer after the First Turn):**
    *   **IMPORTANT:** You are continuing an existing conversation. **DO NOT repeat the full introduction (Apex name, your name, re-stating the loan amount initially established in the first turn) at the start of your response.** Refer to the loan balance naturally within the flow ("this balance", "this amount due").
    *   Your response MUST adapt naturally to the user's *most recent message* and build upon it.
    *   **If they state a reason for non-payment, express hardship, or show emotion:**
        *   **LEAD with SINCERE EMPATHY/VALIDATION (specific to their last message):** Acknowledge and validate their specific situation and feelings immediately based on *what they just said*. Use varied, natural, human-like empathy. ("Oh, [Mr./Ms. Name], I am so genuinely sorry to hear about [mention their specific hardship like being in the hospital]. That sounds incredibly difficult.")
        *   **SMOOTH, SUPPORTIVE, CONCISE PIVOT (After Empathy):** Transition CONCISELY from empathy to finding a way to address the loan balance *despite* their hardship. Use varied, linking phrases that are less repetitive and feel like a natural flow ("Given what you're facing...", "Despite this challenge...", "Knowing that, let's find a manageable step for...").
    *   **If they respond with "nothing" or inability:** Acknowledge compassionately, validate *why* based on hardship, THEN gently probe *very minimal*, *future*, or *alternative* steps (small payments, follow-ups, help from others), phrased concisely. Avoid repetition in the "nothing" handling strategy.
    *   **If they respond with a potential concrete step or piece of information (e.g., "a small payment", "I will pay $1000", "in 2 days", "through cheque"):**
        *   **POSITIVELY AFFIRM & IMMEDIATELY BUILD ON THEIR SPECIFIC INFORMATION:** Show you heard the specific detail they provided (amount, timeframe, method). *Immediately* follow up with the *next* specific piece of information or question needed to finalize that *particular* step. DO NOT re-ask for information they just gave you in a different way.
        *   Examples:
            *   User: "a small payment" -> Bot: "Okay, a small payment sounds like a great starting point! To help me figure out what's most achievable for you, could you let me know *roughly* what amount might feel feasible at this time?" (Asking *what* amount).
            *   User: "I will pay $1000" -> Bot: "Wonderful, $1,000 would definitely make a significant impact! Thank you for committing to that. To set this up, could you let me know *when* that payment would be possible?" (Asking *when*).
            *   User: "in 2 days" -> Bot: "Alright, a payment within two days sounds good! To finalize this, could we specify the *exact date*, just so I can add it to our records accurately? And how will you be sending that payment?" (Asking *exact date* and *method*).
            *   User: "through cheque" -> Bot: "Okay, a cheque payment works! Thanks for letting me know. So, to confirm, it will be a cheque for $[Amount you previously agreed on, or re-ask concisely if amount not set] within [Timeframe previously discussed, or ask concisely]? What's the process you usually follow for sending a cheque payment?" (Confirming previous points and asking process).
            *   Avoid repetitive confirming phrases like "Great, I appreciate you considering that!" repeatedly. Vary affirmations or integrate the thank you naturally into the follow-up question.
        *   Persuade by concisely mentioning BENEFITS related to *that specific step* (e.g., "$1000 would help prevent late fees for X days", "Getting that cheque processed will help improve your credit status").
    *   **Prioritize VARIETY:** CRITICAL. Avoid repeating *exact* or very similar phrases, pivots, and suggestions. Adapt your language naturally based on the flow and the user's exact wording. Sound genuinely human, empathetic, persuasive, and CONCISE.
    *   **Maintain Focus with Kind Persistence:** Gently guide conversation back to the loan after empathy or whenever they stray, without being jarring or repetitive.

3.  **Final Goal (for This Call):** Strive for a concrete agreement (specific amount, specific date, specific method) or a clear next step.

**Your Output:** Your ENTIRE response must be **ONLY the exact text** the Apex Financial Services Representative would speak in THIS SINGLE turn. No instructions, descriptions, scenarios, or parentheses. Just the spoken lines. Review the full history for context, and build directly upon the customer's previous answer.

---
"""

# --- Flask Routes and Application Logic ---

@app.route('/')
def index():
    session['session_id'] = str(uuid.uuid4()) # Assign a unique ID to the session
    session.pop('chat_history_min', None)
    session.pop('customer_idx', None)
    session.pop('customer_name', None)

    logging.info(f"New session started/cleared on index load: {session['session_id']}") # Log session start/clear
    logging.info(f"Initial session state after /: {dict(session)}") # Log the state of the session cookie upon page load

    return render_template('index.html')

# Route to handle finding a customer based on name. Stores minimal data in session.
@app.route('/find_customer', methods=['POST'])
def find_customer():
    customer_name_input = request.json.get('customer_name')
    current_session_id = session.get('session_id', 'NoSessionId') # Get session ID for logging context.

    logging.info(f"Session {current_session_id}: Received customer lookup request for name: '{customer_name_input}'")
    logging.info(f"Session state before lookup: {dict(session)}")


    if df is None:
         logging.error(f"Session {current_session_id}: DataFrame is None during find_customer.")
         return jsonify({"response": "Error: Loan data not loaded on the server. Cannot look up customer."}, 500)

    if not customer_name_input or not customer_name_input.strip():
        logging.warning(f"Session {current_session_id}: Lookup requested with empty or whitespace name.")
        return jsonify({"response": "Please provide a customer name to look up."}), 400

    matched_customers = df[df['Random_Name'].str.lower() == customer_name_input.strip().lower()]


    if not matched_customers.empty:
        # Found match. Get data and store minimal (index, name) in session.
        customer_row = matched_customers.iloc[[0]]
        customer_name_found = customer_row['Random_Name'].iloc[0]
        customer_row_index = matched_customers.index[0] # Get the index

        # --- Store Minimal Data in Session ---
        session['customer_idx'] = int(customer_row_index) # Convert NumPy int64 to standard Python int
        session['customer_name'] = customer_name_found
        session['chat_history_min'] = [] # Start empty minimal history

        logging.info(f"Session {current_session_id}: Customer '{customer_name_found}' found at index {customer_row_index}. Storing minimal data in session.")
        logging.info(f"Session state after successful lookup: {dict(session)}")

        response_msg = f"Thank you, I've located the loan file for {session['customer_name']}. Please click 'Start Talking (Voice)' when you're ready to connect with the Apex representative."
        return jsonify({"response": response_msg, "customer_found": True})


    else:
        # No match. Clear relevant session data and report.
        logging.warning(f"Session {current_session_id}: Customer name '{customer_name_input}' not found in CSV data.")
        response_msg = f"I couldn't find loan details for a customer named {customer_name_input}. Please confirm the name or provide the Loan ID."
        session.pop('customer_idx', None)
        session.pop('customer_name', None)
        session.pop('chat_history_min', None)
        logging.info(f"Session state after customer not found: {dict(session)}")
        return jsonify({"response": response_msg, "customer_found": False})


# --- Main chat route to handle conversation turns ---
# Retrieves minimal session data, reloads customer data from DF, constructs full history for Gemini, calls API.
@app.route('/chat', methods=['POST'])
def chat():
    user_input = request.json.get('text')
    current_session_id = session.get('session_id', 'NoSessionId')

    logging.info(f"Session {current_session_id}: Received chat input from user: '{user_input}'")
    logging.info(f"Session state upon entering /chat: {dict(session)}")


    # --- Input Validation & Session State Check ---
    if df is None:
         logging.error(f"Session {current_session_id}: DataFrame is None in chat route.")
         return jsonify({"response": "Error: Loan data not loaded on the server."}, 500)

    customer_idx = session.get('customer_idx')
    customer_name = session.get('customer_name')
    # Retrieve chat history from the session *at the start of the request*.
    chat_history_min = session.get('chat_history_min', [])


    if customer_idx is None or customer_name is None:
        logging.warning(f"Session {current_session_id}: Chat route called without valid customer index/name in session.")
        logging.debug(f"Session {current_session_id}: Debug state -> customer_idx={customer_idx}, customer_name={customer_name}, chat_history_min length={len(chat_history_min)}.")
        # Session lost message.
        return jsonify({"response": "It seems like the session state was lost. My apologies. Please try finding the customer by name again."})


    # --- Reload Customer Data & Construct Full History for Gemini ---
    try:
        if customer_idx not in df.index:
             logging.error(f"Session {current_session_id}: Stored customer_idx {customer_idx} not found in DataFrame index.")
             session.pop('customer_idx', None)
             session.pop('customer_name', None)
             # session.pop('chat_history_min', None) # Keep history in case we can recover somehow? No, clear state.
             session.pop('chat_history_min', []) # Clear history list
             return jsonify({"response": "Error retrieving customer data. Please try finding the customer again."}, 500)

        customer_row = df.iloc[[customer_idx]]
        formatted_customer_data_string = format_customer_data_for_prompt(customer_row)
        logging.debug(f"Session {current_session_id}: Reloaded and formatted customer data using index {customer_idx}.")

    except Exception as e:
        logging.error(f"Session {current_session_id}: Error reloading customer data from DF for index {customer_idx}: {e}")
        traceback.print_exc()
        session.pop('customer_idx', None)
        session.pop('customer_name', None)
        session.pop('chat_history_min', [])
        return jsonify({"response": "Error retrieving customer data. Please try finding the customer again."}, 500)


    # **Construct the FULL chat history for the Gemini API call in THIS turn.**
    # This includes the initial instruction/data PLUS the dialogue turns from the minimal history.
    # Create a NEW list here to avoid modifying the session list directly before saving.
    full_chat_history_for_gemini = [{'role': 'user', 'parts': [core_system_instruction + "\n\n" + formatted_customer_data_string]}] + chat_history_min[:] # Use slice [:] to create a copy
    logging.debug(f"Session {current_session_id}: Constructed full history for Gemini (length: {len(full_chat_history_for_gemini)}).")


    # --- Add User's Input to Minimal History & Prepare for Gemini ---
    if user_input and user_input.strip():
         cleaned_user_input = user_input.strip()
         # Append to the list for this Gemini call.
         full_chat_history_for_gemini.append({'role': 'user', 'parts': [cleaned_user_input]})
         # Append to the minimal session history (list loaded at start of request).
         chat_history_min.append({'role': 'user', 'parts': [cleaned_user_input]}) # Add to the list loaded from session
         logging.info(f"Session {current_session_id}: Appended cleaned user input to full history for Gemini & minimal session history (local list). New minimal length: {len(chat_history_min)}.")
    else:
         # Empty input. Return prompt without calling Gemini.
         logging.warning(f"Session {current_session_id}: Received empty or whitespace user_input: '{user_input}'. Not appending to history, skipping Gemini call.")
         return jsonify({"response": "I didn't quite catch that. Can you please say that again clearly?"})


    # --- Call Gemini AI Model ---
    if model is None:
        logging.error(f"Session {current_session_id}: Gemini model is not initialized. Cannot call API.")
        return jsonify({"response": "The AI system is currently unavailable. Please try again later."}, 500)


    try:
        # **Call the Gemini API** with the complete history assembled for this turn.
        logging.info(f"Session {current_session_id}: Calling Gemini generate_content with assembled full history (length: {len(full_chat_history_for_gemini)}).")
        response = model.generate_content(full_chat_history_for_gemini)

        # --- Process Gemini's Response ---
        assistant_text = ""
        if response and response.text:
             assistant_text = response.text.strip()
             logging.info(f"Session {current_session_id}: Gemini assistant text received (length: {len(assistant_text)}).")
             logging.debug(f"Session {current_session_id}: Gemini assistant text:\n{assistant_text}")

        elif response and response.prompt_feedback and response.prompt_feedback.block_reason:
            block_reason = response.prompt_feedback.block_reason
            logging.warning(f"Session {current_session_id}: Gemini response blocked: {block_reason}")
            assistant_text = f"I'm sorry, I cannot respond to that query based on my guidelines (Blocked: {block_reason}). Let's focus back on resolving your loan account."

        else:
            logging.warning(f"Session {current_session_id}: Gemini returned empty response text or structure is unexpected.")
            logging.warning(f"Session {current_session_id}: Full response object received:\n{response}")
            assistant_text = "I'm sorry, I couldn't generate a clear response for that. Could you please try rephrasing, focusing on your loan resolution?"

        # --- Update Minimal Session History with Model Response ---
        # Append the assistant's response to the minimal history list (the local list loaded from session).
        chat_history_min.append({'role': 'model', 'parts': [assistant_text]})
        logging.info(f"Session {current_session_id}: Appended assistant response to minimal session history (local list). New minimal length: {len(chat_history_min)}.")

        # **CRITICAL FIX: Manually update the session object with the modified list.**
        # This ensures Flask sees that the list has changed and persists the updated version to the cookie.
        session['chat_history_min'] = chat_history_min
        logging.info(f"Session {current_session_id}: Explicitly saved chat_history_min list back to session.")


    # --- Error Handling for API or Other Server-Side Failures ---
    except Exception as e:
        logging.error(f"Session {current_session_id}: An exception occurred during chat processing or Gemini API call: {e}")
        traceback.print_exc()

        overdue_amount_str_fallback = 'your overdue loan balance'
        # Attempt to get overdue amount from DF using stored index for specificity
        if 'customer_idx' in session and df is not None and session['customer_idx'] in df.index:
            try:
                 customer_row = df.iloc[[session['customer_idx']]]
                 amount_value = customer_row['Current Loan Amount'].iloc[0]
                 overdue_amount_str_fallback = f'${amount_value:,.2f}'

                 logging.debug(f"Session {current_session_id}: Successfully extracted overdue amount from DF for fallback: {overdue_amount_str_fallback}")

            except Exception as parse_e:
                 logging.warning(f"Session {current_session_id}: Could not extract overdue amount from DF for fallback message: {parse_e}")
                 pass

        assistant_text = f"My apologies, I'm experiencing some technical difficulty right now and couldn't fully process that request. But while I have you, I still need to discuss resolving {overdue_amount_str_fallback}. Could we focus on finding a manageable payment option or setting up a plan for that today?"
        # Append error response to minimal history (local list)
        chat_history_min.append({'role': 'model', 'parts': [assistant_text]})
        logging.info(f"Session {current_session_id}: Appended exception fallback message to minimal session history (local list). New minimal length: {len(chat_history_min)}.")
         # **CRITICAL FIX: Manually update the session object with the modified list in error case too.**
        session['chat_history_min'] = chat_history_min
        logging.info(f"Session {current_session_id}: Explicitly saved chat_history_min list back to session after error.")


    # --- Return Response to Frontend ---
    return jsonify({"response": assistant_text})


# --- Flask Application Entry Point ---
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8000))
    logging.info(f"Starting Flask app on http://0.0.0.0:{port} (Debug Mode: {'True' if app.debug else 'False'})...")
    app.run(debug=True, host='0.0.0.0', port=port)