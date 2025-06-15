import os
from flask import Flask, render_template, request, jsonify
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import time
import threading
import queue
import json
import spacy
import datetime
from collections import deque

# Import NLTK's VADER
import nltk
from nltk.sentiment.vader import SentimentIntensityAnalyzer

# Download VADER lexicon if not already downloaded
try:
    nltk.data.find('sentiment/vader_lexicon.zip')
except LookupError:
    nltk.download('vader_lexicon')

# Initialize VADER sentiment analyzer
sia = SentimentIntensityAnalyzer()

# --- Load SpaCy Model ---
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("Downloading en_core_web_sm model for SpaCy. This may take a moment...")
    spacy.cli.download("en_core_web_sm")
    nlp = spacy.load("en_core_web_sm")

app = Flask(__name__)

# --- Global variables for application state ---
live_chat_buffer = deque()  # Stores ALL messages with sentiment
negative_authors = set()
positive_authors = set()

is_scraping_active = False
selenium_driver = None
scraping_thread = None
current_video_url = ""  # To store the URL being scraped
message_id_counter = 0  # Unique ID for each message for frontend tracking

# --- Custom negative words list ---
negative_words =  [
    "2g1c", "2 girls 1 cup", "acrotomophilia", "alabama hot pocket", "alaskan pipeline", "anal",
    "anilingus", "anus", "apeshit", "arsehole", "ass", "asshole", "assmunch", "auto erotic",
    "autoerotic", "babeland", "baby batter", "baby juice", "ball gag", "ball gravy", "ball kicking",
    "ball licking", "ball sack", "ball sucking", "bangbros", "bangbus", "bareback", "barely legal",
    "barenaked", "bastard", "bastardo", "bastinado", "bbw", "bdsm", "beaner", "beaners",
    "beaver cleaver", "beaver lips", "beastiality", "bestiality", "big black", "big breasts",
    "big knockers", "big tits", "bimbos", "birdlock", "bitch", "bitches", "black cock",
    "blonde action", "blonde on blonde action", "blowjob", "blow job", "blow your load",
    "blue waffle", "blumpkin", "bollocks", "bondage", "boner", "boob", "boobs", "booty call",
    "brown showers", "brunette action", "bukkake", "bulldyke", "bullet vibe", "bullshit",
    "bung hole", "bunghole", "busty", "butt", "buttcheeks", "butthole", "camel toe", "camgirl",
    "camslut", "camwhore", "carpet muncher", "carpetmuncher", "chocolate rosebuds", "cialis",
    "circlejerk", "cleveland steamer", "clit", "clitoris", "clover clamps", "clusterfuck", "cock",
    "cocks", "coprolagnia", "coprophilia", "cornhole", "coon", "coons", "creampie", "cum",
    "cumming", "cumshot", "cumshots", "cunnilingus", "cunt", "darkie", "date rape", "daterape",
    "deep throat", "deepthroat", "dendrophilia", "dick", "dildo", "dingleberry", "dingleberries",
    "dirty pillows", "dirty sanchez", "doggie style", "doggiestyle", "doggy style", "doggystyle",
    "dog style", "dolcett", "domination", "dominatrix", "dommes", "donkey punch", "double dong",
    "double penetration", "dp action", "dry hump", "dvda", "eat my ass", "ecchi", "ejaculation",
    "erotic", "erotism", "escort", "eunuch", "fag", "faggot", "fecal", "felch", "fellatio",
    "feltch", "female squirting", "femdom", "figging", "fingerbang", "fingering", "fisting",
    "foot fetish", "footjob", "frotting", "fuck", "fuck buttons", "fuckin", "fucking", "fucktards",
    "fudge packer", "fudgepacker", "futanari", "gangbang", "gang bang", "gay sex", "genitals",
    "giant cock", "girl on", "girl on top", "girls gone wild", "goatcx", "goatse", "god damn",
    "gokkun", "golden shower", "goodpoop", "goo girl", "goregasm", "grope", "group sex", "g-spot",
    "guro", "hand job", "handjob", "hard core", "hardcore", "hentai", "homoerotic", "honkey",
    "hooker", "horny", "hot carl", "hot chick", "how to kill", "how to murder", "huge fat",
    "humping", "incest", "intercourse", "jack off", "jail bait", "jailbait", "jelly donut",
    "jerk off", "jigaboo", "jiggaboo", "jiggerboo", "jizz", "juggs", "kike", "kinbaku", "kinkster",
    "kinky", "knobbing", "leather restraint", "leather straight jacket", "lemon party", "livesex",
    "lolita", "lovemaking", "make me come", "male squirting", "masturbate", "masturbating",
    "masturbation", "menage a trois", "milf", "missionary position", "mong", "motherfucker",
    "mound of venus", "mr hands", "muff diver", "muffdiving", "nambla", "nawashi", "negro",
    "neonazi", "nigga", "nigger", "nig nog", "nimphomania", "nipple", "nipples", "nsfw",
    "nsfw images", "nude", "nudity", "nutten", "nympho", "nymphomania", "octopussy", "omorashi",
    "one cup two girls", "one guy one jar", "orgasm", "orgy", "paedophile", "paki", "panties",
    "panty", "pedobear", "pedophile", "pegging", "penis", "phone sex", "piece of shit", "pikey",
    "pissing", "piss pig", "pisspig", "playboy", "pleasure chest", "pole smoker", "ponyplay",
    "poof", "poon", "poontang", "punany", "poop chute", "poopchute", "porn", "porno", "pornography",
    "prince albert piercing", "pthc", "pubes", "pussy", "queaf", "queef", "quim", "raghead",
    "raging boner", "rape", "raping", "rapist", "rectum", "reverse cowgirl", "rimjob", "rimming",
    "rosy palm", "rosy palm and her 5 sisters", "rusty trombone", "sadism", "santorum", "scat",
    "schlong", "scissoring", "semen", "sex", "sexcam", "sexo", "sexy", "sexual", "sexually",
    "sexuality", "shaved beaver", "shaved pussy", "shemale", "shibari", "shit", "shitblimp",
    "shitty", "shota", "shrimping", "skeet", "slanteye", "slut", "s&m", "smut", "snatch",
    "snowballing", "sodomize", "sodomy", "spastic", "spic", "splooge", "splooge moose", "spooge",
    "spread legs", "spunk", "strap on", "strapon", "strappado", "strip club", "style doggy",
    "suck", "sucks", "suicide girls", "sultry women", "swastika", "swinger", "tainted love",
    "taste my", "tea bagging", "threesome", "throating", "thumbzilla", "tied up", "tight white",
    "tit", "tits", "titties", "titty", "tongue in a", "topless", "tosser", "towelhead", "tranny",
    "tribadism", "tub girl", "tubgirl", "tushy", "twat", "twink", "twinkie", "two girls one cup",
    "undressing", "upskirt", "urethra play", "urophilia", "vagina", "venus mound", "viagra",
    "vibrator", "violet wand", "vorarephilia", "voyeur", "voyeurweb", "voyuer", "vulva", "wank",
    "wetback", "wet dream", "white power", "whore", "worldsex", "wrapping men", "wrinkled starfish",
    "xx", "xxx", "yaoi", "yellow showers", "yiffy", "roasted", "zoophilia", "lol", "🖕"
]

# --- Updated Sentiment Analysis Function using VADER + Negative Word Check ---
def analyze_sentiment(text):
    # VADER sentiment analysis
    scores = sia.polarity_scores(text)
    is_negative = scores['neg'] > 0.3
    is_positive = scores['pos'] > 0.3
    is_neutral = not (is_negative or is_positive)
    polarity = scores['compound']

    # Additional check: presence of negative words
    tokens = text.lower().split()
    contains_neg_word = any(word in tokens for word in negative_words)
    # If contains negative word, override positive detection
    if contains_neg_word:
        is_negative = True
        is_positive = False
        is_neutral = False

    return {
        "is_negative": is_negative,
        "is_positive": is_positive,
        "is_neutral": is_neutral,
        "polarity": polarity
    }

# --- Selenium Live Chat Scraper Function ---
def start_live_chat_scraper(video_url):
    global is_scraping_active, selenium_driver, current_video_url, message_id_counter
    global live_chat_buffer, negative_authors, positive_authors

    if is_scraping_active:
        print("Scraping already active.")
        return

    is_scraping_active = True
    current_video_url = video_url
    print(f"Starting live chat scraping for: {video_url}")

    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36")
    options.add_argument("--disable-gpu")
    options.add_argument("--log-level=3")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-browser-side-navigation")
    options.add_argument("--disable-features=VizDisplayCompositor")

    try:
        service = Service(ChromeDriverManager().install())
        selenium_driver = webdriver.Chrome(service=service, options=options)
        selenium_driver.get(video_url)

        # Wait for iframe with chat
        WebDriverWait(selenium_driver, 60).until(
            EC.frame_to_be_available_and_switch_to_it((By.CSS_SELECTOR, "iframe#chatframe"))
        )
        print("Switched to chat iframe successfully.")

        # Wait for chat messages to load
        WebDriverWait(selenium_driver, 30).until(
            EC.presence_of_element_located((By.XPATH, '//yt-live-chat-text-message-renderer'))
        )
        print("Initial chat messages found.")

        scraper_seen_message_ids = deque(maxlen=5000)

        while is_scraping_active:
            try:
                # Scroll to bottom
                selenium_driver.execute_script("""
                    var chatContainer = document.querySelector('#item-scroller');
                    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
                """)
                time.sleep(0.5)

                message_elements = selenium_driver.find_elements(By.XPATH, '//yt-live-chat-text-message-renderer')

                new_messages_found = False
                for msg_element in message_elements:
                    try:
                        author_element = msg_element.find_element(By.ID, 'author-name')
                        message_text_element = msg_element.find_element(By.ID, 'message')

                        author = author_element.text.strip()
                        message_text = message_text_element.text.strip()

                        current_utc_timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds') + "Z"

                        # Use hash for deduplication
                        message_hash = hash(f"{author}{message_text}")
                        if message_hash not in scraper_seen_message_ids:
                            # Analyze sentiment
                            sentiment_results = analyze_sentiment(message_text)

                            # Assign message ID
                            message_id_counter += 1
                            unique_frontend_id = message_id_counter

                            message_data = {
                                "id": unique_frontend_id,
                                "author": author,
                                "timestamp": current_utc_timestamp,
                                "message": message_text,
                                "is_negative": sentiment_results["is_negative"],
                                "is_positive": sentiment_results["is_positive"],
                                "is_neutral": sentiment_results["is_neutral"],
                                "polarity": sentiment_results["polarity"]
                            }
                            live_chat_buffer.append(message_data)

                            # Track authors
                            if sentiment_results["is_negative"]:
                                negative_authors.add(author)
                            if sentiment_results["is_positive"]:
                                positive_authors.add(author)

                            scraper_seen_message_ids.append(message_hash)
                            new_messages_found = True
                    except Exception:
                        pass  # Skip malformed messages

                if not new_messages_found:
                    time.sleep(1.5)
                else:
                    time.sleep(0.5)

            except Exception as e_outer:
                print(f"Error during scraping loop: {e_outer}")
                try:
                    selenium_driver.switch_to.default_content()
                    WebDriverWait(selenium_driver, 10).until(
                        EC.frame_to_be_available_and_switch_to_it((By.CSS_SELECTOR, "iframe#chatframe"))
                    )
                    print("Re-switched to chat iframe after error.")
                except Exception as re_e:
                    print(f"CRITICAL: Could not re-switch iframe. Stopping scraping. Error: {re_e}")
                    break

    except Exception as e_init:
        print(f"Failed to initialize Selenium or navigate: {e_init}")
    finally:
        if selenium_driver:
            try:
                selenium_driver.quit()
            except Exception as e:
                print(f"Error quitting driver: {e}")
            selenium_driver = None
        is_scraping_active = False
        current_video_url = ""
        live_chat_buffer.clear()
        negative_authors.clear()
        positive_authors.clear()
        message_id_counter = 0
        print("Scraping thread stopped.")

def stop_live_chat_scraper():
    global is_scraping_active, selenium_driver, scraping_thread, current_video_url
    global live_chat_buffer, negative_authors, positive_authors, message_id_counter

    if is_scraping_active:
        is_scraping_active = False
        if selenium_driver:
            try:
                selenium_driver.quit()
            except Exception as e:
                print(f"Error quitting driver: {e}")
            selenium_driver = None
        if scraping_thread and scraping_thread.is_alive():
            scraping_thread.join(timeout=5)
            if scraping_thread.is_alive():
                print("Scraping thread did not terminate gracefully.")
        current_video_url = ""
        live_chat_buffer.clear()
        negative_authors.clear()
        positive_authors.clear()
        message_id_counter = 0
        print("Selenium scraping explicitly stopped and data cleared.")
    else:
        print("Scraping not active, no need to stop.")

@app.route('/', methods=['GET', 'POST'])
def home_dashboard():
    global scraping_thread, is_scraping_active, current_video_url
    global live_chat_buffer, negative_authors, positive_authors

    if request.method == 'POST':
        action = None
        if 'action' in request.form:
            action = request.form['action']
        elif request.is_json:
            try:
                data = request.get_json()
                action = data.get('action')
            except:
                return jsonify({"status": "Error: Invalid JSON format."}), 400
        else:
            return jsonify({"status": "Error: Unknown request format."}), 400

        if action == 'start_scrape':
            video_url = request.form.get('video_url')
            if not video_url and request.is_json:
                video_url = data.get('video_url')

            if not video_url:
                return jsonify({"status": "Error: Missing video URL."}), 400

            if is_scraping_active:
                if current_video_url == video_url:
                    return jsonify({"status": "Scraping is already active for this URL."})
                else:
                    return jsonify({"status": "Scraping is active for a different URL. Please stop it first."})

            # Clear buffers for new scrape
            live_chat_buffer.clear()
            negative_authors.clear()
            positive_authors.clear()
            global message_id_counter
            message_id_counter = 0

            # Start scraping thread
            scraping_thread = threading.Thread(target=start_live_chat_scraper, args=(video_url,))
            scraping_thread.daemon = True
            scraping_thread.start()
            return jsonify({"status": "Scraping started.", "video_url": video_url})

        elif action == 'stop_scrape':
            stop_live_chat_scraper()
            return jsonify({"status": "Scraping stopped."})

        elif action == 'get_live_data':
            last_message_id = 0
            if request.is_json:
                try:
                    data = request.get_json()
                    last_message_id = data.get('last_message_id', 0)
                except:
                    pass

            # Filter new messages
            new_messages = [msg for msg in live_chat_buffer if msg["id"] > last_message_id]
            new_messages.sort(key=lambda x: x['id'])

            total_messages = len(live_chat_buffer)
            negative_count = sum(1 for msg in live_chat_buffer if msg["is_negative"])
            positive_count = sum(1 for msg in live_chat_buffer if msg["is_positive"])
            neutral_count = sum(1 for msg in live_chat_buffer if msg["is_neutral"])

            return jsonify({
                "messages": new_messages,
                "is_active": is_scraping_active,
                "current_url": current_video_url if is_scraping_active else "",
                "total_messages_count": total_messages,
                "negative_messages_count": negative_count,
                "positive_messages_count": positive_count,
                "neutral_messages_count": neutral_count,
                "negative_authors_list": sorted(list(negative_authors)),
                "positive_authors_list": sorted(list(positive_authors)),
                "last_message_id": message_id_counter
            })

        return jsonify({"status": "Error: Unknown action."}), 400

    return render_template('dashboard.html', current_video_url=current_video_url)

if __name__ == '__main__':
    if not os.path.exists('templates'):
        os.makedirs('templates')
    if not os.path.exists('static/css'):
        os.makedirs('static/css')
    if not os.path.exists('static/js'):
        os.makedirs('static/js')

    app.run(debug=True, port=5000, host='127.0.0.1')