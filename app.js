const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const stopwords = require('natural/lib/natural/util/stopwords').words;

const notion = new Client({ auth: "ntn_S56144750764kLw0QZRNqw06yN3uOBtcWUmx880nJDNfZ5" });
const databaseId = "16914ea6174480a7be71dba3ae0ab8dc";
const companiesDatabaseId = "16914ea61744806d86d6fee2718216cb";
const mediaFolderPath = 'D:/Backend project/notion - Safe/media'; 

const companyNames = [
    "IDFC First Bank",
    "HDFC Bank",
    "Kotak Mahindra",
    "Angel One",
    "FYI",
    "CDSL/CAMS",
    "NIFTY",
    "CRISIL",
    "Aptus Value Housing",
    "PI Industries",
    "HUL",
    "Asian Paints",
    "Indigo Paints",
    "HDFC Life",
    "Max Hospital",
    "Apollo",
    "TCS",
    "Infy",
    "Apple",
    "Swiggy"
];

const companyPageCache = new Map();


function extractCompaniesFromMessage(message) {
    return companyNames.filter(company => 
        message.toLowerCase().includes(company.toLowerCase())
    );
}

async function getCompanyPageId(companyName) {
    if (companyPageCache.has(companyName)) {
        return companyPageCache.get(companyName);
    }

    try {
        const response = await notion.databases.query({
            database_id: companiesDatabaseId,
            filter: {
                property: "Name",
                title: {
                    equals: companyName,
                },
            },
        });

        if (response.results.length > 0) {
            const pageId = response.results[0].id;
            companyPageCache.set(companyName, pageId);
            return pageId;
        }

        const newPage = await notion.pages.create({
            parent: { database_id: companiesDatabaseId },
            properties: {
                Name: {
                    title: [{ text: { content: companyName } }],
                },
            },
        });

        companyPageCache.set(companyName, newPage.id);
        return newPage.id;
    } catch (error) {
        console.error(`Error getting/creating company page for ${companyName}:`, error.message);
        return null;
    }
}

function generateHeading(message) {
    const cleanMessage = message.replace(/^.*?:\s/, "");
    let words = tokenizer.tokenize(cleanMessage) || [];
    words = words.map(word => word.toLowerCase())
        .filter(word => !stopwords.includes(word))
        .filter(word => word.length > 2);
    let headingWords = words.slice(0, 3);
    let heading = headingWords
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    return heading.length < 3 ? "General Message" : heading;
}

function splitMessageIntoChunks(message, maxLength = 2000) {
    if (message.length <= maxLength) {
        return [message];
    }

    const paragraphs = message.split('\n\n');
    const chunks = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
        const sentences = paragraph.split('. ');
        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > maxLength) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = '';
                }
                if (sentence.length > maxLength) {
                    for (let i = 0; i < sentence.length; i += maxLength) {
                        chunks.push(sentence.slice(i, i + maxLength));
                    }
                } else {
                    currentChunk = sentence;
                }
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
        }
        if (currentChunk) {
            chunks .push(currentChunk.trim());
            currentChunk = '';
        }
    }

    return chunks;
}

function mergeMessagesIfTimeIntervalMatches(entries) {
    const mergedEntries = [];
    let lastMergedEntry = null;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const currentTime = new Date(`${entry.date}T${entry.time}`).getTime();

        const photoMatch = entry.message ? entry.message.match(/<attached: (.+?)>/) : null;
        if (photoMatch) {
            entry.photo_path = photoMatch[1];
            entry.message = entry.message.replace(/<attached: (.+?)>/, '').trim();
        }

        if (lastMergedEntry) {
            const previousTime = new Date(`${lastMergedEntry.date}T${lastMergedEntry.time}`).getTime();
            const timeDifference = currentTime - previousTime;

            if (timeDifference <= 60 * 1000) {
                if (lastMergedEntry.photo_path && entry.photo_path) {
                    lastMergedEntry.photo_path += `, ${entry.photo_path}`;
                    continue;
                }
                if (lastMergedEntry.photo_path && entry.message) {
                    lastMergedEntry.message += "\n\n" + entry.message;
                    continue;
                }
                if (lastMergedEntry.message && entry.photo_path) {
                    lastMergedEntry.photo_path = entry.photo_path;
                    lastMergedEntry.message += "\n\n" + entry.message;
                    continue;
                }
            }
        }

        mergedEntries.push(entry);
        lastMergedEntry = entry;
    }

    return mergedEntries;

}


function formatMessage(message) {
    const messageWithoutSender = message.replace(/^.*?:\s/, "");
    let formattedMessage = messageWithoutSender.split('. ').map(sentence => {
        if (sentence.includes(':')) {
            return sentence;
        }
        return sentence.trim() + '.';
    }).join('.\n\n');
    formattedMessage = formattedMessage.replace(/(\(\d+\))/g, '\n$1');
    formattedMessage = formattedMessage.replace(/-\s/g, '\n- ');
    return formattedMessage.trim();
}

async function createNotionPages(entries) {
    const mergedEntries = mergeMessagesIfTimeIntervalMatches(entries);

    for (const entry of mergedEntries) {
        try {
            const date = entry.date || null;
            const time = entry.time || null;
            const message = entry.message || "";
            const photoPaths = entry.photo_path ? entry.photo_path.split(',').map(p => p.trim()) : [];

            if (!date || !time) {
                console.warn(`Skipping entry due to missing date or time: ${JSON.stringify(entry)}`);
                continue;
            }

            const autoHeading = generateHeading(message);
            const mentionedCompanies = extractCompaniesFromMessage(message);

            const companyRelations = [];
            for (const company of mentionedCompanies) {
                const companyId = await getCompanyPageId(company);
                if (companyId) {
                    companyRelations.push({
                        id: companyId
                    });
                }
            }

            const messageChunks = splitMessageIntoChunks(message);
            let children = [];

            // Add message chunks
            children = children.concat(messageChunks.map(chunk => ({
                object: 'block',
                type: 'paragraph',
                paragraph: {
                    rich_text: [{
                        type: 'text',
                        text: { content: chunk }
                    }]
                }
            })));

            // Handle images
            for (const photoPath of photoPaths) {
                const fullPath = path.join(mediaFolderPath, photoPath);

                if (fs.existsSync(fullPath)) {
                    try {
                                
                        const fileBuffer = fs.readFileSync(fullPath);
                        
                        
                        children.push({
                            object: 'block',
                            type: 'file',
                            file: {
                                type: 'file',
                                file: {
                                    
                                    content: fileBuffer.toString('base64'),
                                    name: photoPath,
                                    type: 'image/jpg'
                                }
                            }
                        });
                        
                        console.log(`Added file block for image: ${photoPath}`);
                    } catch (fileError) {
                        console.error(`Error processing file ${photoPath}:`, fileError);
                    }
                } else {
                    console.warn(`Could not find image for path: ${fullPath}`);
                }
            }

            const response = await notion.pages.create({
                parent: { database_id: databaseId },
                properties: {
                    Title: {
                        title: [{
                            text: {
                                content: `${autoHeading}`
                            }
                        }],
                    },
                    Date: {
                        date: { start: `${date}T${time}` },
                    },
                    Companies: {
                        relation: companyRelations
                    }
                },
                children: children
            });

            console.log(`Notion page created for ${date} at ${time} with heading: ${autoHeading}`);
        } catch (error) {
            console.error(`Error creating Notion page: ${error.message}`);
            console.log("Problematic entry:", JSON.stringify(entry, null, 2));
        }
    }
}

function parseWhatsAppFile(filePath, startDate) {
    const data = fs.readFileSync(filePath, 'utf-8');
    const lines = data.split('\n');
    const entries = [];
    const startDateTime = new Date(startDate).getTime();
    const todayDateTime = new Date().getTime();

    let currentDate = '';
    let currentTime = '';
    let currentMessage = '';
    let currentPhotoPath = null;

    lines.forEach(line => {
        const dateTimeMatch = line.match(/(\d{2}\/\d{2}\/\d{2}), (\d{2}:\d{2}:\d{2})/);
        const photoMatch = line.match(/<attached: (.+?)>/);

        if (dateTimeMatch) {
            const newDate = dateTimeMatch[1];
            const newTime = dateTimeMatch[2];
            const isoNewDate = toISODate(newDate, newTime);
            const entryDateTime = new Date(isoNewDate).getTime();

            if (entryDateTime >= startDateTime && entryDateTime <= todayDateTime) {
                if (currentMessage || currentPhotoPath) {
                    entries.push({
                        date: isoNewDate.split('T')[0],
                        time: isoNewDate.split('T')[1],
                        message: currentPhotoPath ? currentMessage : formatMessage(currentMessage),
                        photo_path: currentPhotoPath
                    });
                }

                currentDate = newDate;
                currentTime = newTime;
                currentMessage = line.replace(dateTimeMatch[0], '').trim();
                currentPhotoPath = null;
            }
        } else if (photoMatch) {
            currentPhotoPath = photoMatch[1];
        } else {
            currentMessage += ' ' + line.trim();
        }
    });

    return entries;
}


function toISODate(dateStr, timeStr) {
    const [day, month, year] = dateStr.split('/');
    return `${2000 + parseInt(year)}-${month}-${day}T${timeStr}`;
}





async function main() {
    const filePath = 'new_chat.txt';
    const startDate = '2024-09-25'; // Example start date
    const entries = parseWhatsAppFile(filePath, startDate);
    console.log(`Parsed ${entries.length} entries from WhatsApp file.`);
    await createNotionPages(entries);
    console.log('All entries added to Notion.');
}

main().catch(console.error);