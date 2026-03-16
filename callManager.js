import { EventEmitter } from 'events';

class CallManager extends EventEmitter {
    constructor(queueItem, languageEngine, characterManager) {
        super();

        this.queueItem = queueItem;
        this.languageEngine = languageEngine;
        this.characterManager = characterManager;

        // Call state
        this.contactId = queueItem.contact_id;
        this.phone = queueItem.phone;
        this.name = queueItem.name || 'Student';
        this.preferredLanguage = queueItem.language_preference || 'en';
        this.detectedLanguage = queueItem.detected_language || 'en';
        this.currentLanguage = 'en'; // Always start in English

        // Conversation tracking
        this.conversation = [];
        this.conversationStartTime = new Date();
        this.exchangeCount = 0;
        this.maxExchanges = parseInt(process.env.MAX_CONVERSATION_EXCHANGES) || 6;

        // Results tracking
        this.finalStatus = 'not_interested';
        this.finalRsvp = 'none';
        this.characterUsage = 0;
        this.totalVoiceUsed = false;
        this.lastIntent = 'unclear';

        console.log(`📞 CallManager initialized for ${this.phone} (${this.name})`);
    }

    async startCall() {
        try {
            console.log(`🎯 Starting automated call with ${this.name} (${this.phone})`);

            // Step 1: Initial introduction (always in English)
            const introResult = await this.sendIntroduction();

            if (!introResult.success) {
                throw new Error(`Introduction failed: ${introResult.error}`);
            }

            // Step 2: Conversation loop (4-6 exchanges)
            await this.conductConversation();

            // Step 3: Finalize results
            this.finalizeCallResults();

            console.log(`✅ Call completed with ${this.name}: ${this.finalStatus} (${this.finalRsvp})`);

            return this.getCallResults();

        } catch (error) {
            console.error(`❌ Call failed with ${this.name}:`, error.message);
            this.finalStatus = 'failed';

            return this.getCallResults(error);
        }
    }

    async sendIntroduction() {
        try {
            // Get introduction template (always start in English)
            const introText = await this.languageEngine.getTemplate('intro', 'en');

            // Check if we can use voice for introduction
            const canUseVoice = await this.shouldUseVoice(introText, 'en');

            // Send the introduction
            const result = await this.sendMessage(introText, 'en', canUseVoice, true);

            // Log the introduction
            this.conversation.push({
                type: 'ai_message',
                language: 'en',
                content: introText,
                voiceUsed: canUseVoice,
                timestamp: new Date(),
                characterCount: introText.length
            });

            this.exchangeCount++;

            return { success: true, voiceUsed: canUseVoice };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async conductConversation() {
        while (this.exchangeCount < this.maxExchanges) {
            try {
                // Simulate receiving student response (in a real implementation, this would come from actual phone/voice input)
                const studentResponse = await this.getStudentResponse();

                if (!studentResponse || studentResponse.trim().length === 0) {
                    console.log('👋 Student hung up or no response received');
                    this.finalStatus = 'no_response';
                    break;
                }

                // Log student response
                this.conversation.push({
                    type: 'student_response',
                    content: studentResponse,
                    timestamp: new Date()
                });

                // Process the response with language engine
                const responseAnalysis = await this.languageEngine.processStudentResponse(
                    studentResponse,
                    this.currentLanguage,
                    this.conversation
                );

                // Update detected language if it changed
                if (responseAnalysis.detectedLanguage !== this.currentLanguage) {
                    console.log(`🌐 Language detected: ${this.currentLanguage} -> ${responseAnalysis.detectedLanguage}`);
                    this.currentLanguage = responseAnalysis.detectedLanguage;

                    // Update in database
                    await this.languageEngine.db.updateContactLanguage(this.contactId, this.currentLanguage);
                }

                // Store intent for result analysis
                this.lastIntent = responseAnalysis.intent;

                // Check if we should continue the conversation
                if (!responseAnalysis.shouldContinue) {
                    console.log(`🏁 Conversation completed based on intent: ${responseAnalysis.intent}`);
                    this.finalizeBasedOnIntent(responseAnalysis.intent);
                    break;
                }

                // Determine if we should use voice for response
                const canUseVoice = await this.shouldUseVoice(responseAnalysis.response, this.currentLanguage);

                // Send AI response
                await this.sendMessage(responseAnalysis.response, this.currentLanguage, canUseVoice);

                // Log AI response
                this.conversation.push({
                    type: 'ai_message',
                    language: this.currentLanguage,
                    content: responseAnalysis.response,
                    intent: responseAnalysis.intent,
                    voiceUsed: canUseVoice,
                    timestamp: new Date(),
                    characterCount: responseAnalysis.characterCount
                });

                // Update character usage
                this.characterUsage += responseAnalysis.characterCount;
                if (canUseVoice) {
                    this.totalVoiceUsed = true;
                }

                this.exchangeCount++;

                // Special handling for certain intents
                if (responseAnalysis.intent === 'interested') {
                    // Follow up with seminar details and RSVP
                    await this.handleInterestFollowUp();
                    break;
                } else if (responseAnalysis.intent === 'callback') {
                    await this.handleCallbackRequest();
                    break;
                }

            } catch (error) {
                console.error('💥 Error during conversation:', error);
                // Continue conversation despite errors, but log them
                this.conversation.push({
                    type: 'error',
                    content: error.message,
                    timestamp: new Date()
                });
            }
        }

        // If we reached max exchanges without conclusion
        if (this.exchangeCount >= this.maxExchanges) {
            console.log('⏰ Conversation reached maximum exchanges, concluding politely');
            await this.sendPoliteConclusion();
        }
    }

    async handleInterestFollowUp() {
        try {
            // Send seminar details
            const seminarDetails = await this.languageEngine.getTemplate('seminar_invite', this.currentLanguage);
            const canUseVoice = await this.shouldUseVoice(seminarDetails, this.currentLanguage);

            await this.sendMessage(seminarDetails, this.currentLanguage, canUseVoice);

            this.conversation.push({
                type: 'ai_message',
                language: this.currentLanguage,
                content: seminarDetails,
                intent: 'seminar_invite',
                voiceUsed: canUseVoice,
                timestamp: new Date(),
                characterCount: seminarDetails.length
            });

            this.characterUsage += seminarDetails.length;

            // Get RSVP response (simulated)
            const rsvpResponse = await this.getRsvpResponse();

            if (rsvpResponse && rsvpResponse.toLowerCase().includes('yes')) {
                this.finalStatus = 'interested';
                this.finalRsvp = 'yes';

                // Send confirmation
                const confirmation = await this.languageEngine.getTemplate('rsvp_yes', this.currentLanguage);
                const confirmVoice = await this.shouldUseVoice(confirmation, this.currentLanguage);

                await this.sendMessage(confirmation, this.currentLanguage, confirmVoice);
                this.characterUsage += confirmation.length;

            } else {
                this.finalStatus = 'not_interested';
                this.finalRsvp = 'no';
            }

        } catch (error) {
            console.error('Error in interest follow-up:', error);
            this.finalStatus = 'interested'; // Assume positive if there was interest
        }
    }

    async handleCallbackRequest() {
        try {
            const callbackMsg = await this.languageEngine.getTemplate('callback', this.currentLanguage);
            const canUseVoice = await this.shouldUseVoice(callbackMsg, this.currentLanguage);

            await this.sendMessage(callbackMsg, this.currentLanguage, canUseVoice);

            this.finalStatus = 'callback';
            this.finalRsvp = 'maybe';
            this.characterUsage += callbackMsg.length;

        } catch (error) {
            console.error('Error handling callback:', error);
            this.finalStatus = 'callback';
        }
    }

    async sendPoliteConclusion() {
        try {
            const conclusion = await this.languageEngine.getTemplate('not_interested', this.currentLanguage);
            const canUseVoice = await this.shouldUseVoice(conclusion, this.currentLanguage);

            await this.sendMessage(conclusion, this.currentLanguage, canUseVoice);

            this.conversation.push({
                type: 'ai_message',
                language: this.currentLanguage,
                content: conclusion,
                intent: 'polite_closure',
                voiceUsed: canUseVoice,
                timestamp: new Date(),
                characterCount: conclusion.length
            });

            this.characterUsage += conclusion.length;

            if (this.lastIntent === 'unclear' || this.lastIntent === 'positive_engagement') {
                this.finalStatus = 'callback'; // Give them benefit of doubt
                this.finalRsvp = 'maybe';
            }

        } catch (error) {
            console.error('Error sending polite conclusion:', error);
        }
    }

    finalizeBasedOnIntent(intent) {
        switch (intent) {
            case 'interested':
                this.finalStatus = 'interested';
                this.finalRsvp = 'yes';
                break;
            case 'not_interested':
                this.finalStatus = 'not_interested';
                this.finalRsvp = 'no';
                break;
            case 'callback':
                this.finalStatus = 'callback';
                this.finalRsvp = 'maybe';
                break;
            case 'questions':
            case 'positive_engagement':
                this.finalStatus = 'callback'; // Follow up later
                this.finalRsvp = 'maybe';
                break;
            default:
                this.finalStatus = 'not_interested';
                this.finalRsvp = 'none';
        }
    }

    async shouldUseVoice(text, language) {
        try {
            // Check voice priority mode
            const voiceMode = process.env.VOICE_PRIORITY_MODE || 'smart';

            if (voiceMode === 'never') return false;
            if (voiceMode === 'always') return true;

            // Smart mode: check character budget and priority
            const canAfford = await this.languageEngine.canUseVoiceForLanguage(language, text.length);

            if (!canAfford) return false;

            // Prioritize voice for:
            // 1. Introductions (first message)
            // 2. Interested responses
            // 3. RSVP confirmations
            const isIntroduction = this.conversation.length === 0;
            const isImportantResponse = this.lastIntent === 'interested' || text.includes('register') || text.includes('confirmation');

            return isIntroduction || isImportantResponse;

        } catch (error) {
            console.error('Error checking voice budget:', error);
            return false; // Default to text-only on errors
        }
    }

    async sendMessage(content, language, useVoice, isIntroduction = false) {
        try {
            if (useVoice && process.env.ENABLE_VOICE !== 'false') {
                // Use voice engine (to be implemented)
                console.log(`🔊 [${language.toUpperCase()}] Voice: "${content.substring(0, 50)}..."`);

                // Update character usage in character manager
                await this.characterManager.addUsage(language, content.length);
            } else {
                // Text-only mode
                console.log(`💬 [${language.toUpperCase()}] Text: "${content.substring(0, 50)}..."`);
            }

            // Simulate message sending delay
            await new Promise(resolve => setTimeout(resolve, 1000 + (content.length * 10)));

            return { success: true, characterCount: useVoice ? content.length : 0 };

        } catch (error) {
            console.error('Error sending message:', error);
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    // Simulated student response methods (in real implementation, these would come from voice recognition)
    async getStudentResponse() {
        // Simulate different types of student responses based on conversation context
        const responses = {
            en: [
                "Yes, I'm preparing for MHT CET",
                "Tell me more about this seminar",
                "I'm not interested, thank you",
                "Can you call me later?",
                "Is this free?",
                "Yes, I want to register"
            ],
            hi: [
                "हाँ, मैं MHT CET की तैयारी कर रहा हूँ",
                "इस सेमिनार के बारे में और बताइए",
                "मुझे इंटरेस्ट नहीं है, धन्यवाद",
                "क्या आप बाद में कॉल कर सकते हैं?",
                "यह फ्री है क्या?",
                "हाँ, मैं register करना चाहता हूँ"
            ],
            mr: [
                "होय, मी MHT CET ची तयारी करत आहे",
                "या सेमिनारबद्दल अधिक सांगा",
                "मला स्वारस्य नाही, धन्यवाद",
                "तुम्ही नंतर कॉल करू शकता का?",
                "हे फ्री आहे का?",
                "होय, मला register करायचे आहे"
            ]
        };

        // Simulate response based on exchange count and language
        const languageResponses = responses[this.currentLanguage] || responses.en;
        const responseIndex = Math.min(this.exchangeCount - 1, languageResponses.length - 1);

        // Add some randomness and context awareness
        if (this.exchangeCount === 1) {
            // First response - usually positive engagement
            return languageResponses[Math.random() > 0.7 ? 0 : 1];
        } else if (this.exchangeCount >= 3) {
            // Later responses - more likely to be decisive
            return languageResponses[Math.random() > 0.5 ? 5 : 2]; // Register or not interested
        } else {
            // Middle responses - questions and engagement
            return languageResponses[Math.floor(Math.random() * 4) + 1];
        }
    }

    async getRsvpResponse() {
        // Simulate RSVP response (80% positive for interested students)
        const positiveResponses = {
            en: "Yes, I want to register for the seminar",
            hi: "हाँ, मैं सेमिनार के लिए register करना चाहता हूँ",
            mr: "होय, मला सेमिनारसाठी register करायचे आहे"
        };

        const negativeResponses = {
            en: "I need to think about it",
            hi: "मुझे इसके बारे में सोचना होगा",
            mr: "मला याबद्दल विचार करायचा आहे"
        };

        const isPositive = Math.random() > 0.2; // 80% positive rate
        const responses = isPositive ? positiveResponses : negativeResponses;

        return responses[this.currentLanguage] || responses.en;
    }

    finalizeCallResults() {
        // Update contact in database with final results
        try {
            this.languageEngine.db.updateContactResult(
                this.contactId,
                this.finalStatus,
                this.finalRsvp,
                `Conversation completed: ${this.exchangeCount} exchanges, Language: ${this.currentLanguage}`
            );
        } catch (error) {
            console.error('Error updating contact results:', error);
        }
    }

    getCallResults(error = null) {
        const duration = Math.floor((Date.now() - this.conversationStartTime.getTime()) / 1000);

        return {
            contactId: this.contactId,
            phone: this.phone,
            name: this.name,
            language: this.currentLanguage,
            finalStatus: this.finalStatus,
            finalRsvp: this.finalRsvp,
            conversationDuration: duration,
            exchangeCount: this.exchangeCount,
            transcript: this.conversation,
            characterUsage: this.characterUsage,
            voiceUsed: this.totalVoiceUsed,
            aiMessages: this.conversation.filter(c => c.type === 'ai_message').length,
            studentResponses: this.conversation.filter(c => c.type === 'student_response').length,
            error: error ? error.message : null,
            completed: true
        };
    }
}

export default CallManager;