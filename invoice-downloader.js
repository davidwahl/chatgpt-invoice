const Imap = require("imap")
const { simpleParser } = require("mailparser")
const nodemailer = require("nodemailer")
const { chromium } = require("playwright")
const fs = require("fs").promises
const path = require("path")
const { program } = require("commander")
const https = require("https")

// Load configuration
let config
try {
	config = require("./config.js")
} catch (error) {
	console.error("Error: config.js not found!")
	console.error("Please copy config.example.js to config.js and fill in your details.")
	process.exit(1)
}

const EMAIL = config.email
const APP_PASSWORD = config.appPassword
const RECEIVER_EMAIL = config.receiverEmail
const NAME = config.name
const FILENAME_NAME = config.filenameName
const OPENAI_PAYID = config.openaiPayId

// Helper function to get timestamp
function timestamp() {
	const now = new Date()
	return `[${now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}]`
}

// Override console.log to include timestamps
const originalLog = console.log
console.log = function (...args) {
	originalLog(timestamp(), ...args)
}

// Function to send email with attachment
async function sendInvoiceEmail(invoicePath, invoiceDate) {
	console.log(`Preparing to send invoice email for ${invoiceDate}...`)

	const transporter = nodemailer.createTransport({
		host: "smtp.gmail.com",
		port: 465,
		secure: true,
		auth: {
			user: EMAIL,
			pass: APP_PASSWORD,
		},
	})

	const mailOptions = {
		from: EMAIL,
		to: RECEIVER_EMAIL,
		subject: `ChatGPT Invoice for ${NAME} ${invoiceDate}`,
		text: `Please find attached the ChatGPT invoice for ${invoiceDate}.\n\nThis email was automatically generated.`,
		attachments: [
			{
				filename: path.basename(invoicePath),
				path: invoicePath,
			},
		],
	}

	try {
		await transporter.sendMail(mailOptions)
		console.log(`Invoice email sent successfully to ${RECEIVER_EMAIL}`)
		return true
	} catch (error) {
		console.error(`Error sending email: ${error}`)
		return false
	}
}

// Function to request login link via API (faster alternative)
async function requestLoginLinkViaAPI() {
	console.log("Requesting login link via API...")

	try {
		const response = await fetch("https://pay.openai.com/v1/billing_portal/access_client/send_access?include_only%5B%5D=id%2Cclient_secret", {
			method: "POST",
			headers: {
				authorization: "Bearer pk_live_51HOrSwC6h1nxGoI3lTAgRjYVrz4dU3fVOabyCcKR3pbEJguCVAlqCxdxCUvoRh1XWwRacViovU3kLKvpkjh7IqkW00iXQsjo3n",
				"content-type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				slug: OPENAI_PAYID,
				email: EMAIL,
				locale: "en",
			}),
		})

		if (response.ok) {
			const data = await response.json()
			console.log("Login link request sent successfully via API")
			return true
		} else {
			console.log(`API request failed with status ${response.status}`)
			return false
		}
	} catch (error) {
		console.log(`API request failed: ${error.message}`)
		return false
	}
}

// Function to request the login link
async function requestLoginLink() {
	// Try API method first (faster)
	const apiSuccess = await requestLoginLinkViaAPI()

	if (apiSuccess) {
		return
	}

	// Fall back to browser method
	console.log("Falling back to browser method for requesting login link...")

	const browser = await chromium.launch({ headless: true })
	const context = await browser.newContext()
	const page = await context.newPage()

	try {
		const url = `https://pay.openai.com/p/login/${OPENAI_PAYID}`
		console.log(`Opening URL: ${url}`)
		await page.goto(url)

		// Look for email input field
		const selectors = ["input[type='email']", "input[name='email']", "input[placeholder*='email' i]", "input[id*='email' i]"]

		let emailField = null
		for (const selector of selectors) {
			try {
				emailField = await page.waitForSelector(selector, { timeout: 15000 })
				console.log(`Found email field with selector: ${selector}`)
				break
			} catch (e) {
				continue
			}
		}

		if (emailField) {
			console.log(`Entering email address: ${EMAIL}`)
			await emailField.fill(EMAIL)

			console.log("Submitting form...")
			await emailField.press("Enter")
			await page.waitForTimeout(2000)

			// Try to find and click a submit button
			try {
				const buttons = await page.locator("button").all()
				for (const button of buttons) {
					const isVisible = await button.isVisible()
					const type = await button.getAttribute("type")
					const className = (await button.getAttribute("class")) || ""
					const text = (await button.textContent()) || ""

					if (isVisible && (type === "submit" || className.toLowerCase().includes("submit") || text.toLowerCase().includes("continue") || text.toLowerCase().includes("login") || text.toLowerCase().includes("sign in"))) {
						console.log(`Clicking submit button with text: '${text}'`)
						await button.click()
						break
					}
				}
			} catch (e) {
				console.error(`Error finding submit button: ${e}`)
			}

			await page.waitForTimeout(5000)
			console.log("Login link request submitted successfully.")
		} else {
			console.log("Could not find email input field")
		}
	} catch (error) {
		console.error(`Unexpected error: ${error}`)
	} finally {
		await browser.close()
		console.log("Browser closed")
	}
}

// Function to extract login URL from email
function extractLoginUrl(emailBody) {
	const match = emailBody.match(/https:\/\/pay\.openai\.com\/p\/session\/[^\s"'<>]+/)
	return match ? match[0] : null
}

// Function to check Gmail for the login link
async function checkGmailForLoginLink() {
	console.log("Checking Gmail for login link...")

	return new Promise((resolve, reject) => {
		const imap = new Imap({
			user: EMAIL,
			password: APP_PASSWORD,
			host: "imap.gmail.com",
			port: 993,
			tls: true,
			tlsOptions: {
				rejectUnauthorized: false,
				servername: "imap.gmail.com",
			},
		})

		let connectionClosed = false

		function closeConnection(result) {
			if (!connectionClosed) {
				connectionClosed = true
				imap.end()
				resolve(result)
			}
		}

		imap.once("ready", () => {
			imap.openBox("INBOX", false, (err, box) => {
				if (err) {
					return closeConnection(null)
				}

				// Search for emails with subject containing "customer portal login link"
				imap.search(["UNSEEN", ["SUBJECT", "Your customer portal login link"], ["OR", ["HEADER", "FROM", "openai"], ["HEADER", "FROM", "stripe"]]], (err, primaryResults) => {
					if (err) return closeConnection(null)

					const useResults = primaryResults && primaryResults.length ? primaryResults : null

					// Fallback: search all mail for the exact link pattern to be safe
					const fallbackSearch = () => {
						imap.search([["SUBJECT", "Your customer portal login link"]], (err2, allResults) => {
							if (err2 || !allResults || !allResults.length) {
								console.log("No OpenAI/Stripe login emails found.")
								return closeConnection(null)
							}
							processResults(allResults)
						})
					}

					if (useResults) {
						processResults(useResults)
					} else {
						fallbackSearch()
					}
				})

				function processResults(results) {
					if (!results || results.length === 0) {
						return closeConnection(null)
					}

					// Newest first
					const reversedResults = results.slice().reverse()

					let processed = 0
					let foundUrl = null

					reversedResults.forEach((emailId) => {
						try {
							const f = imap.fetch(emailId, { bodies: "" })

							f.on("message", (msg) => {
								msg.on("body", (stream) => {
									simpleParser(stream, (err, parsed) => {
										if (foundUrl) return // already have it, ignore the rest

										if (err) {
											console.error("mailparser error:", err.message || err)
											processed++
											if (processed === reversedResults.length && !foundUrl) {
												closeConnection(null)
											}
											return
										}

										const senderText = parsed.from && parsed.from.text ? parsed.from.text : "(unknown sender)"
										const subjectText = parsed.subject || "(no subject)"
										console.log(`Checking email from: ${senderText}`)
										console.log(`Email subject: ${subjectText}`)

										// Prefer HTML, then text. (textAsHtml covers some plaintext with links)
										const body = parsed.html || parsed.textAsHtml || parsed.text || ""
										const loginUrl = extractLoginUrl(body) // looks for https://pay.openai.com/p/session/...

										if (loginUrl && !foundUrl) {
											foundUrl = loginUrl
											console.log(`Found login URL: ${loginUrl}`)
											return closeConnection(loginUrl)
										}

										processed++
										if (processed === reversedResults.length && !foundUrl) {
											closeConnection(null)
										}
									})
								})
							})

							f.once("error", (err) => {
								console.error("Fetch error:", err && err.message ? err.message : err)
								processed++
								if (processed === reversedResults.length && !foundUrl) {
									closeConnection(null)
								}
							})
						} catch (e) {
							console.error("Unexpected fetch error:", e && e.message ? e.message : e)
							processed++
							if (processed === reversedResults.length && !foundUrl) {
								closeConnection(null)
							}
						}
					})
				}
			})
		})

		imap.once("error", (err) => {
			console.error("IMAP error:", err)
			closeConnection(null)
		})

		imap.connect()
	})
}

// Function to test if login link is valid
async function testLoginLink(loginUrl) {
	console.log(`Testing if login URL is valid: ${loginUrl}`)

	const browser = await chromium.launch({ headless: true })
	const context = await browser.newContext()
	const page = await context.newPage()

	try {
		await page.goto(loginUrl, { waitUntil: "domcontentloaded" })
		await page.waitForTimeout(2000)

		const currentUrl = page.url()
		if (currentUrl.toLowerCase().includes("error") || currentUrl.toLowerCase().includes("expired")) {
			console.log("Login link appears to be expired or invalid")
			await browser.close()
			return false
		}

		// Try to find invoice links
		try {
			await page.waitForSelector("a[href*='invoice.stripe.com']", { timeout: 5000 })
			console.log("Login link appears to be valid (found invoice links)")
			await browser.close()
			return true
		} catch {
			try {
				await page.waitForSelector("div.db-CustomerPortalRoot", { timeout: 5000 })
				console.log("Login link appears to be valid (found portal root element)")
				await browser.close()
				return true
			} catch {
				console.log("Could not verify portal loaded correctly")
				await browser.close()
				return false
			}
		}
	} catch (error) {
		console.error(`Error testing login link: ${error}`)
		await browser.close()
		return false
	}
}

// Function to extract API credentials from login URL
async function extractAPICredentials(loginUrl) {
	console.log("Extracting API credentials from login URL...")

	try {
		const response = await fetch(loginUrl, {
			redirect: "follow",
			headers: {
				"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
			},
		})

		const html = await response.text()

		// Extract session ID (format: bps_XXXXXXXXX)
		const sessionMatch = html.match(/bps_[A-Za-z0-9]+/)

		// Extract bearer token (format: ek_live_XXXXXXXXX)
		const tokenMatch = html.match(/ek_live_[A-Za-z0-9_-]+/)

		if (sessionMatch && tokenMatch) {
			console.log(`Found session ID: ${sessionMatch[0]}`)
			console.log(`Found bearer token: ${tokenMatch[0].substring(0, 20)}...`)
			return { sessionId: sessionMatch[0], token: tokenMatch[0] }
		} else {
			console.log("Could not extract API credentials from HTML")
			return null
		}
	} catch (error) {
		console.log(`Failed to extract API credentials: ${error.message}`)
		return null
	}
}

// Function to fetch invoices directly from Stripe API
async function fetchInvoicesFromAPI(sessionId, token) {
	console.log("Fetching invoices from Stripe API...")

	try {
		const apiUrl = `https://pay.openai.com/v1/billing_portal/sessions/${sessionId}/invoices`

		const response = await fetch(apiUrl, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${token}`,
				"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
			},
		})

		if (!response.ok) {
			throw new Error(`API request failed: ${response.status} ${response.statusText}`)
		}

		const data = await response.json()

		if (!data.data || !Array.isArray(data.data)) {
			throw new Error("Unexpected API response format")
		}

		// Convert API data to our invoice format
		const invoices = data.data.map((inv, index) => {
			// Convert Unix timestamp to readable date
			const date = new Date(inv.effective_at * 1000)
			const formattedDate = date.toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
			})

			// Convert amount from cents to dollars
			const amount = `${(inv.amount_paid / 100).toFixed(2)}`

			return {
				id: inv.id,
				url: inv.hosted_invoice_url,
				pdfUrl: inv.invoice_pdf,
				date: formattedDate,
				amount: amount,
				status: inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
				description: inv.lines.data[0]?.description || "Unknown description",
				number: inv.number,
			}
		})

		console.log(`Successfully fetched ${invoices.length} invoices from API`)
		return invoices
	} catch (error) {
		console.log(`Failed to fetch from API: ${error.message}`)
		return null
	}
}

// Function to extract invoice information from browser
async function extractInvoiceInfoFromBrowser(page) {
	const invoices = []

	try {
		console.log("Waiting for invoice history section to load...")
		await page.waitForSelector("a[href*='invoice.stripe.com']", { timeout: 10000 })

		const invoiceLinks = await page.locator("a[href*='invoice.stripe.com']").all()
		console.log(`Found ${invoiceLinks.length} invoice links on the page`)

		for (let i = 0; i < invoiceLinks.length; i++) {
			try {
				const link = invoiceLinks[i]
				const href = await link.getAttribute("href")

				let date = "Unknown date"
				let amount = "Unknown amount"
				let status = "Unknown status"
				let description = "Unknown description"

				// Use shorter timeouts and don't wait long for missing elements
				try {
					const dateElement = link.locator("span[class*='1opxpgz']").first()
					date = await dateElement.textContent({ timeout: 1000 })
				} catch (e) {}

				try {
					const amountElement = link.locator("span[class*='1opxpgz']").nth(1)
					amount = await amountElement.textContent({ timeout: 1000 })
				} catch (e) {}

				try {
					const statusElement = link.locator("span[class*='sn-6ldk2i']")
					status = await statusElement.textContent({ timeout: 1000 })
				} catch (e) {}

				const invoice = {
					id: `invoice_${i + 1}`,
					url: href,
					date,
					amount,
					status,
					description,
				}

				invoices.push(invoice)
				console.log(`Found invoice: ${date} - ${amount} - ${status}`)
			} catch (error) {
				console.error(`Error extracting invoice info: ${error}`)
			}
		}
	} catch (error) {
		console.error(`Error finding invoice section: ${error}`)
	}

	return invoices
}

// Function to download invoices
async function downloadInvoices(invoices, downloadDir = "invoices", topOnly = true) {
	if (!invoices || invoices.length === 0) {
		console.log("No invoices to download")
		return
	}

	// Create download directory if it doesn't exist
	try {
		await fs.mkdir(downloadDir, { recursive: true })
		console.log(`Created download directory: ${downloadDir}`)
	} catch (e) {}

	const invoicesToDownload = topOnly ? [invoices[0]] : invoices

	if (topOnly) {
		console.log("Download mode: TOP INVOICE ONLY")
		console.log(`Will download only the most recent invoice: ${invoices[0].date} - ${invoices[0].amount}`)
	} else {
		console.log("Download mode: ALL INVOICES")
	}

	console.log(`Starting download of ${invoicesToDownload.length} invoice(s) to ${downloadDir}...`)

	let successCount = 0

	for (let i = 0; i < invoicesToDownload.length; i++) {
		const invoice = invoicesToDownload[i]

		try {
			console.log(`Downloading invoice ${i + 1}/${invoicesToDownload.length}: ${invoice.date} - ${invoice.amount}`)

			// Format filename
			let formattedDate = invoice.date
			try {
				const dateFormats = [
					{ regex: /(\d{1,2})\s+(\w+)\s+(\d{4})/, format: (d, m, y) => `${y}-${getMonthNumber(m)}-${d.padStart(2, "0")}` },
					{ regex: /(\w+)\s+(\d{1,2}),\s+(\d{4})/, format: (m, d, y) => `${y}-${getMonthNumber(m)}-${d.padStart(2, "0")}` },
				]

				for (const fmt of dateFormats) {
					const match = invoice.date.match(fmt.regex)
					if (match) {
						formattedDate = fmt.format(...match.slice(1))
						break
					}
				}
			} catch (e) {
				formattedDate = invoice.date.replace(/\s+/g, "_").replace(/,/g, "")
			}

			const filename = `OpenAI_${formattedDate}_${FILENAME_NAME}.pdf`
			const filePath = path.join(downloadDir, filename)

			// Check if file exists
			try {
				await fs.access(filePath)
				console.log(`Invoice already exists: ${filename}`)
				successCount++
				continue
			} catch (e) {}

			// Use direct PDF URL if available (from API), otherwise construct it
			let pdfUrl
			if (invoice.pdfUrl) {
				pdfUrl = invoice.pdfUrl
				console.log(`Using PDF URL from API: ${pdfUrl}`)
			} else {
				// Convert invoice URL to direct PDF URL
				pdfUrl = invoice.url.replace("https://invoice.stripe.com/i/", "https://pay.stripe.com/invoice/").replace(/\?.*$/, "/pdf")
				console.log(`Constructed PDF URL: ${pdfUrl}`)
			}

			try {
				// Download the PDF directly using native fetch
				const pdfResponse = await fetch(pdfUrl)

				if (!pdfResponse.ok) {
					throw new Error(`HTTP ${pdfResponse.status}: ${pdfResponse.statusText}`)
				}

				const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())

				// Save the PDF file
				await fs.writeFile(filePath, pdfBuffer)

				console.log(`Invoice downloaded successfully: ${filename}`)

				// Send email with the invoice
				console.log("Sending invoice email...")
				await sendInvoiceEmail(filePath, invoice.date)
				successCount++
			} catch (e) {
				console.log(`Failed to download PDF: ${e.message}`)
			}

			await sleep(500)
		} catch (error) {
			console.error(`Error downloading invoice ${i + 1}: ${error}`)
		}
	}

	console.log(`Download complete: ${successCount}/${invoicesToDownload.length} invoices downloaded`)
}

// Helper function to get month number
function getMonthNumber(month) {
	const months = {
		jan: "01",
		january: "01",
		feb: "02",
		february: "02",
		mar: "03",
		march: "03",
		apr: "04",
		april: "04",
		may: "05",
		jun: "06",
		june: "06",
		jul: "07",
		july: "07",
		aug: "08",
		august: "08",
		sep: "09",
		sept: "09",
		september: "09",
		oct: "10",
		october: "10",
		nov: "11",
		november: "11",
		dec: "12",
		december: "12",
	}
	return months[month.toLowerCase()] || "01"
}

async function extractAPICredentialsNative(loginUrl) {
	console.log("Fetching page directly with HTTPS...")

	return new Promise((resolve, reject) => {
		const url = new URL(loginUrl)

		const options = {
			hostname: url.hostname,
			path: url.pathname + url.search,
			protocol: url.protocol,
			headers: {
				"User-Agent": "Node.js",
				Accept: "text/html,application/xhtml+xml",
			},
		}

		https
			.get(options, (res) => {
				let html = ""
				const cookies = res.headers["set-cookie"] || []

				res.on("data", (chunk) => (html += chunk))
				res.on("end", () => {
					// Try to extract credentials from the HTML
					const sessionMatch = html.match(/bps_[A-Za-z0-9]+/)
					const tokenMatch = html.match(/ek_live_[A-Za-z0-9_-]+/)

					const result = {
						sessionId: sessionMatch ? sessionMatch[0] : null,
						token: tokenMatch ? tokenMatch[0] : null,
						cookies: cookies,
					}

					console.log(`Found session ID: ${result.sessionId}`)
					console.log(`Found bearer token: ${result.token ? result.token.substring(0, 20) + "..." : null}`)
					console.log(`Captured ${cookies.length} cookies`)

					if (!result.sessionId && !result.token) {
						console.warn("Could not find credentials in static HTML — page might be rendered client-side.")
					}

					resolve(result)
				})
			})
			.on("error", (err) => {
				reject(err)
			})
	})
}

// Function to extract API credentials using Playwright (with cookies and CSRF)
async function extractAPICredentialsWithBrowser(loginUrl) {
	console.log("Using browser to extract API credentials with session...")

	const browser = await chromium.launch({ headless: true })
	const context = await browser.newContext()
	const page = await context.newPage()

	try {
		// Navigate to login URL to establish session
		await page.goto(loginUrl, { waitUntil: "domcontentloaded" })
		await page.waitForTimeout(2000)

		// Extract session ID and bearer token from page content
		const pageContent = await page.content()
		const sessionMatch = pageContent.match(/bps_[A-Za-z0-9]+/)
		const tokenMatch = pageContent.match(/ek_live_[A-Za-z0-9_-]+/)

		if (!sessionMatch || !tokenMatch) {
			console.log("Could not find session ID or bearer token in page")
			await browser.close()
			return null
		}

		// Get cookies from the browser context
		const cookies = await context.cookies()

		// Extract CSRF token from cookies or page
		let csrfToken = null
		for (const cookie of cookies) {
			if (cookie.name === "stripe.customerportal.csrf") {
				csrfToken = cookie.value
				break
			}
		}

		// If not in cookies, try to find it in the page
		if (!csrfToken) {
			const csrfMatch = pageContent.match(/csrf["\s:]+["']([^"']+)["']/i)
			if (csrfMatch) {
				csrfToken = csrfMatch[1]
			}
		}

		console.log(`Found session ID: ${sessionMatch[0]}`)
		console.log(`Found bearer token: ${tokenMatch[0].substring(0, 20)}...`)
		console.log(`Found CSRF token: ${csrfToken ? csrfToken.substring(0, 20) + "..." : "not found"}`)
		console.log(`Captured ${cookies.length} cookies`)

		await browser.close()

		return {
			sessionId: sessionMatch[0],
			token: tokenMatch[0],
			csrfToken: csrfToken,
			cookies: cookies,
		}
	} catch (error) {
		console.log(`Failed to extract credentials: ${error.message}`)
		await browser.close()
		return null
	}
}

// Function to fetch invoices directly from Stripe API with full credentials
async function fetchInvoicesFromAPI(apiCreds) {
	console.log("Fetching invoices from Stripe API...")

	try {
		const apiUrl = `https://pay.openai.com/v1/billing_portal/sessions/${apiCreds.sessionId}/invoices`

		// Build cookie header
		const cookieHeader = apiCreds.cookies.map((c) => `${c.name}=${c.value}`).join("; ")

		const headers = {
			accept: "application/json",
			authorization: `Bearer ${apiCreds.token}`,
			"stripe-version": "2025-06-30.basil",
			"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
			cookie: cookieHeader,
		}

		// Add CSRF token if available
		if (apiCreds.csrfToken) {
			headers["x-stripe-csrf-token"] = apiCreds.csrfToken
		}

		const response = await fetch(apiUrl, { headers })

		if (!response.ok) {
			throw new Error(`API request failed: ${response.status} ${response.statusText}`)
		}

		const data = await response.json()

		if (!data.data || !Array.isArray(data.data)) {
			throw new Error("Unexpected API response format")
		}

		// Convert API data to our invoice format
		const invoices = data.data.map((inv) => {
			// Convert Unix timestamp to readable date
			const date = new Date(inv.effective_at * 1000)
			const formattedDate = date.toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
			})

			// Convert amount from cents to dollars
			const amount = `${(inv.amount_paid / 100).toFixed(2)}`

			return {
				id: inv.id,
				url: inv.hosted_invoice_url,
				pdfUrl: inv.invoice_pdf,
				date: formattedDate,
				amount: amount,
				status: inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
				description: inv.lines.data[0]?.description || "Unknown description",
				number: inv.number,
			}
		})

		console.log(`Successfully fetched ${invoices.length} invoices from API`)
		return invoices
	} catch (error) {
		console.log(`Failed to fetch from API: ${error.message}`)
		return null
	}
}

// Function to access billing portal
async function accessBillingPortal(loginUrl, download = false, downloadDir = "invoices", headless = true, topOnly = true) {
	console.log(`Accessing billing portal with URL: ${loginUrl}`)

	const browser = await chromium.launch({ headless })
	const context = await browser.newContext()
	const page = await context.newPage()

	try {
		await page.goto(loginUrl, { waitUntil: "domcontentloaded" })

		// Just wait for invoice links directly, skip checking for portal root
		console.log("Waiting for billing portal to load...")
		try {
			await page.waitForSelector("a[href*='invoice.stripe.com']", { timeout: 8000 })
			console.log("Portal loaded successfully")
		} catch (e) {
			console.error(`Failed to detect portal load: ${e.message}`)
		}

		const invoices = await extractInvoiceInfoFromBrowser(page)

		if (invoices.length > 0) {
			console.log(`\nFound ${invoices.length} invoices:`)
			invoices.forEach((invoice, i) => {
				console.log(`${i + 1}. ${invoice.date} - ${invoice.amount} - ${invoice.status} - ${invoice.description}`)
				console.log(`   URL: ${invoice.url}`)
			})

			await browser.close()

			if (download) {
				await downloadInvoices(invoices, downloadDir, topOnly)
			}

			return invoices
		} else {
			console.log("No invoices found")
			await browser.close()
			return []
		}
	} catch (error) {
		console.error(`Error accessing billing portal: ${error}`)
		await browser.close()
		return []
	}
}

// Helper function to sleep
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// Main function
async function main() {
	program.option("--request", "Force requesting a new login link instead of checking emails first").option("--download-dir <dir>", "Directory to save downloaded invoices", "invoices").option("--no-headless", "Run in visible browser mode").option("--all-invoices", "Download all invoices instead of just the top/most recent one").option("--list-only", "Just list available invoices without downloading").parse(process.argv)

	const options = program.opts()

	console.log("Starting OpenAI invoice downloader...")

	if (options.request) {
		console.log("Requesting a new login link as specified...")
		await requestLoginLink()
		console.log("Waiting 30 seconds for email to arrive...")
		await sleep(30000)
	}

	const maxAttempts = 10
	let loginUrl = null
   let requestedOnceThisRun = false; 

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		console.log(`Checking for login email (attempt ${attempt}/${maxAttempts})...`)

		try {
			loginUrl = await checkGmailForLoginLink()
		} catch (error) {
			console.error(`Error checking Gmail: ${error.message}`)
			loginUrl = null
		}

		if (loginUrl) {
			console.log(`Found login URL, attempting to use API method...`)

			// Use Playwright to get session with cookies
			//const apiCreds = await extractAPICredentialsWithBrowser(loginUrl);

			// Use native HTTPS method to get credentials
			const apiCreds = await extractAPICredentialsNative(loginUrl)

			let invoices = null

			if (apiCreds) {
				// Try to fetch invoices from API with full credentials
				invoices = await fetchInvoicesFromAPI(apiCreds)

				if (invoices && invoices.length > 0) {
					console.log(`\nSuccessfully fetched ${invoices.length} invoices from API:`)
					invoices.forEach((invoice, i) => {
						console.log(`${i + 1}. ${invoice.date} - ${invoice.amount} - ${invoice.status}`)
						console.log(`   ${invoice.description}`)
						console.log(`   PDF: ${invoice.pdfUrl}`)
					})

					// Download invoices
					if (!options.listOnly) {
						await downloadInvoices(invoices, options.downloadDir, !options.allInvoices)
					} else {
						console.log("List-only mode specified. Invoices have been listed but not downloaded.")
					}

					console.log("Successfully processed invoices!")
					return // Exit early - we're done!
				}
			}

			// Fallback to browser scraping method if API fails
			console.log("API method failed, falling back to browser scraping...")

			const isValid = await testLoginLink(loginUrl)

			if (isValid) {
				try {
					console.log("Accessing billing portal with valid link...")
					const invoices = await accessBillingPortal(
						loginUrl,
						!options.listOnly, // download if NOT list-only
						options.downloadDir,
						options.headless !== false,
						!options.allInvoices
					)

					if (invoices.length > 0) {
						if (options.listOnly) {
							console.log("List-only mode specified. Invoices have been listed but not downloaded.")
						} else {
							console.log("Successfully processed invoices!")
						}
						// Success - exit the loop
						return
					} else {
						console.log("No invoices found with the current link.")
						console.log("Requesting a new login link...")
						await requestLoginLink()
						console.log("Waiting 30 seconds for email to arrive...")
						await sleep(30000)
						loginUrl = null
					}
				} catch (error) {
					console.error(`Error accessing billing portal: ${error}`)
					console.log("Requesting a new login link...")
					await requestLoginLink()
					console.log("Waiting 30 seconds for email to arrive...")
					await sleep(30000)
					loginUrl = null
				}
			} else {
				console.log("Login link is invalid or expired.")
				console.log("Requesting a new login link...")
				await requestLoginLink()
				console.log("Waiting 30 seconds for email to arrive...")
				await sleep(30000)
				loginUrl = null
			}
		}

      if (!requestedOnceThisRun) {
         console.log("No valid login link found in emails. Requesting a new one...");
         await requestLoginLink();
         requestedOnceThisRun = true;
         console.log("Waiting 45 seconds for email to arrive...");
         await sleep(45000);
      }

		if (!loginUrl && attempt < maxAttempts) {
			console.log("Waiting 15 seconds before checking again...")
			await sleep(15000)
		}
	}

	if (!loginUrl) {
		console.log(`Failed to find or use a valid login link after ${maxAttempts} attempts.`)
	}
}

// Run main function
if (require.main === module) {
	main().catch(console.error)
}

module.exports = {
	sendInvoiceEmail,
	requestLoginLink,
	checkGmailForLoginLink,
	testLoginLink,
	accessBillingPortal,
	downloadInvoices,
}
