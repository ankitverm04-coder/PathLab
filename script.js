const timeSlots = document.querySelectorAll(".time-slot");
const bookingForm = document.getElementById("bookingForm");
const bookingStatus = document.getElementById("bookingStatus");
const appointmentDateInput = document.getElementById("appointmentDate");
const reportSearchButton = document.getElementById("reportSearchButton");
const reportIdInput = document.getElementById("reportIdInput");
const reportResult = document.getElementById("reportResult");
const loginPhoneNumberInput = document.getElementById("loginPhoneNumber");
const requestOtpButton = document.getElementById("requestOtpButton");
const otpRequestStatus = document.getElementById("otpRequestStatus");
const demoOtpNote = document.getElementById("demoOtpNote");
const otpPanel = document.getElementById("otpPanel");
const otpInput = document.getElementById("otpInput");
const verifyOtpButton = document.getElementById("verifyOtpButton");
const logoutButton = document.getElementById("logoutButton");
const dashboardLogoutButton = document.getElementById("dashboardLogoutButton");
const otpVerifyStatus = document.getElementById("otpVerifyStatus");
const patientDashboard = document.getElementById("patientDashboard");
const dashboardPatientName = document.getElementById("dashboardPatientName");
const dashboardPhoneLabel = document.getElementById("dashboardPhoneLabel");
const appointmentList = document.getElementById("appointmentList");
const patientReportList = document.getElementById("patientReportList");
const navToggle = document.querySelector(".nav-toggle");
const topbar = document.querySelector(".topbar");
const siteNav = document.getElementById("siteNav");
const themeToggle = document.getElementById("themeToggle");

let selectedSlot = "7:00 AM - 8:00 AM";

const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0")
].join("-");

appointmentDateInput.min = today;
appointmentDateInput.value = today;

timeSlots.forEach((slotButton) => {
  slotButton.addEventListener("click", () => {
    timeSlots.forEach((button) => button.classList.remove("active"));
    slotButton.classList.add("active");
    selectedSlot = slotButton.dataset.slot;
  });
});

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const patientName = document.getElementById("patientName").value.trim();
  const phoneNumber = document.getElementById("phoneNumber").value.trim();
  const address = document.getElementById("address").value.trim();
  const city = document.getElementById("city").value.trim();
  const packageName = document.getElementById("package").value;
  const appointmentDate = appointmentDateInput.value;
  const notes = document.getElementById("notes").value.trim();

  bookingStatus.textContent = "Saving your appointment...";

  try {
    const response = await fetch("/api/appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientName,
        phoneNumber,
        address,
        city,
        appointmentDate,
        packageName,
        timeSlot: selectedSlot,
        notes
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to create appointment");
    }

    bookingStatus.innerHTML = `
      <strong>Appointment confirmed</strong><br>
      Booking ID: ${result.bookingId}<br>
      Report ID: ${result.reportId}<br>
      ${result.patientName} is scheduled for <strong>${result.packageName}</strong> on <strong>${result.appointmentDate}</strong> at <strong>${result.timeSlot}</strong>.<br>
      Sample collection address: ${result.address}, ${result.city}. We will contact you on ${result.phoneNumber}.
    `;

    loginPhoneNumberInput.value = result.phoneNumber;
    bookingForm.reset();
    appointmentDateInput.min = today;
    appointmentDateInput.value = today;
    timeSlots.forEach((button) => button.classList.remove("active"));
    timeSlots[0].classList.add("active");
    selectedSlot = timeSlots[0].dataset.slot;
  } catch (error) {
    bookingStatus.textContent = error.message || "Something went wrong while booking the appointment.";
  }
});

requestOtpButton.addEventListener("click", requestOtp);
verifyOtpButton.addEventListener("click", verifyOtp);
logoutButton.addEventListener("click", logoutPatient);
dashboardLogoutButton.addEventListener("click", logoutPatient);

reportSearchButton.addEventListener("click", () => {
  renderReport(reportIdInput.value.trim().toUpperCase());
});

reportIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    renderReport(reportIdInput.value.trim().toUpperCase());
  }
});

otpInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    verifyOtp();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  initializeThemeToggle();
  setupMobileNav();
  loadPatientDashboard();
});

function initializeThemeToggle() {
  if (!themeToggle) {
    return;
  }

  const savedTheme = localStorage.getItem("pathlab-theme");
  const preferredTheme = savedTheme || "light";
  applyTheme(preferredTheme);

  themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    localStorage.setItem("pathlab-theme", nextTheme);
  });
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.dataset.theme = isDark ? "dark" : "light";

  if (!themeToggle) {
    return;
  }

  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  themeToggle.querySelector(".theme-toggle-icon").textContent = isDark ? "L" : "D";
  themeToggle.querySelector(".theme-toggle-label").textContent = isDark ? "Light Mode" : "Dark Mode";
}

function setupMobileNav() {
  if (!navToggle || !topbar || !siteNav) {
    return;
  }

  const closeMenu = () => {
    topbar.classList.remove("menu-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open navigation menu");
  };

  navToggle.addEventListener("click", () => {
    const willOpen = !topbar.classList.contains("menu-open");
    topbar.classList.toggle("menu-open", willOpen);
    navToggle.setAttribute("aria-expanded", String(willOpen));
    navToggle.setAttribute("aria-label", willOpen ? "Close navigation menu" : "Open navigation menu");
  });

  siteNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.innerWidth <= 640) {
        closeMenu();
      }
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 640) {
      closeMenu();
    }
  });
}

async function requestOtp() {
  const phoneNumber = normalizePhone(loginPhoneNumberInput.value);

  if (!phoneNumber) {
    otpRequestStatus.textContent = "Please enter a valid 10-digit phone number.";
    return;
  }

  otpRequestStatus.textContent = "Requesting OTP...";
  demoOtpNote.classList.add("hidden");

  try {
    const response = await fetch("/api/auth/request-otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phoneNumber })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to send OTP");
    }

    otpPanel.classList.remove("hidden");
    otpRequestStatus.textContent = `${result.message} OTP valid for ${result.expiresInMinutes} minutes.`;

    if (result.deliveryMode === "demo" && result.demoOtp) {
      demoOtpNote.textContent = `Demo OTP: ${result.demoOtp}`;
      demoOtpNote.classList.remove("hidden");
    } else {
      demoOtpNote.textContent = "SMS provider is configured, so the OTP has been sent to the patient phone.";
      demoOtpNote.classList.remove("hidden");
    }

    otpInput.focus();
  } catch (error) {
    otpRequestStatus.textContent = error.message || "Unable to request OTP.";
  }
}

async function verifyOtp() {
  const phoneNumber = normalizePhone(loginPhoneNumberInput.value);
  const otp = otpInput.value.trim();

  if (!phoneNumber || !otp) {
    otpVerifyStatus.textContent = "Enter both phone number and OTP.";
    return;
  }

  otpVerifyStatus.textContent = "Verifying OTP...";

  try {
    const response = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phoneNumber, otp })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "OTP verification failed");
    }

    otpVerifyStatus.textContent = "Login successful. Loading your dashboard...";
    await loadPatientDashboard();
  } catch (error) {
    otpVerifyStatus.textContent = error.message || "OTP verification failed.";
  }
}

async function logoutPatient() {
  await fetch("/api/auth/logout", { method: "POST" });
  patientDashboard.classList.add("hidden");
  otpPanel.classList.add("hidden");
  demoOtpNote.classList.add("hidden");
  otpInput.value = "";
  otpVerifyStatus.textContent = "OTP verification status will appear here.";
  otpRequestStatus.textContent = "Use the phone number from your appointment booking.";
}

async function loadPatientDashboard() {
  try {
    const response = await fetch("/api/patient/dashboard");

    if (response.status === 401) {
      patientDashboard.classList.add("hidden");
      return;
    }

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to load patient dashboard");
    }

    patientDashboard.classList.remove("hidden");
    otpPanel.classList.remove("hidden");
    dashboardPatientName.textContent = `${result.patient.patientName}'s reports and appointments`;
    dashboardPhoneLabel.textContent = `Registered mobile: ${result.patient.phoneNumber}`;
    otpVerifyStatus.textContent = "Logged in";
    renderAppointmentList(result.appointments);
    renderPatientReportList(result.reports);
  } catch (error) {
    patientDashboard.classList.add("hidden");
  }
}

function renderAppointmentList(appointments) {
  if (!appointments.length) {
    appointmentList.innerHTML = `<p class="report-placeholder">No appointments found for this patient.</p>`;
    return;
  }

  appointmentList.innerHTML = appointments.map((appointment) => `
    <article class="data-item">
      <div class="data-item-header">
        <strong>${appointment.packageName}</strong>
        <span class="report-badge processing">${appointment.status}</span>
      </div>
      <p>${appointment.appointmentDate} at ${appointment.timeSlot}</p>
      <p>${appointment.city} · Booking ID ${appointment.bookingId}</p>
      <p>Report ID: <code>${appointment.reportId}</code></p>
    </article>
  `).join("");
}

function renderPatientReportList(reports) {
  if (!reports.length) {
    patientReportList.innerHTML = `<p class="report-placeholder">No reports found for this patient.</p>`;
    return;
  }

  patientReportList.innerHTML = reports.map((report) => `
    <article class="data-item">
      <div class="data-item-header">
        <strong>${report.packageName}</strong>
        <span class="report-badge ${report.badgeClass}">${report.status}</span>
      </div>
      <p>Report ID: <code>${report.reportId}</code></p>
      <p>Updated: ${report.updatedOn}</p>
      <div class="inline-actions compact-actions">
        <button class="button button-secondary report-preview-button" type="button" data-report-id="${report.reportId}">View report</button>
        ${report.canDownload ? `<a class="button button-primary" href="/api/download-report/${report.reportId}">${report.hasPdf ? "Download PDF" : "Download"}</a>` : `<button class="button button-primary" type="button" disabled>Download</button>`}
      </div>
    </article>
  `).join("");

  document.querySelectorAll(".report-preview-button").forEach((button) => {
    button.addEventListener("click", () => {
      reportIdInput.value = button.dataset.reportId;
      renderReport(button.dataset.reportId);
      reportResult.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function renderReport(reportId) {
  if (!reportId) {
    reportResult.innerHTML = `
      <p class="report-placeholder">
        Please enter a report ID. You can also try one of the demo IDs shown on the left.
      </p>
    `;
    return;
  }

  reportResult.innerHTML = `<p class="report-placeholder">Searching report details...</p>`;

  try {
    const response = await fetch(`/api/reports/${reportId}`);
    const report = await response.json();

    if (!response.ok) {
      throw new Error(report.error || "Report not found");
    }

    const downloadButton = report.canDownload
      ? `<a class="button button-primary" href="/api/download-report/${reportId}">${report.hasPdf ? "Download PDF Report" : report.downloadLabel}</a>`
      : `<button class="button button-primary" type="button" disabled>${report.downloadLabel}</button>`;

    reportResult.innerHTML = `
      <div class="report-card-header">
        <div>
          <p class="eyebrow">Report found</p>
          <h3>${report.patient}</h3>
          <p class="report-status">${report.packageName}</p>
        </div>
        <span class="report-badge ${report.badgeClass}">${report.status}</span>
      </div>

      <div class="report-meta">
        <article>
          <strong>Collected on</strong>
          <span>${report.collectedOn}</span>
        </article>
        <article>
          <strong>Last updated</strong>
          <span>${report.updatedOn}</span>
        </article>
      </div>

      <div>
        <strong>Doctor note</strong>
        <p class="report-placeholder">${report.doctorNote}</p>
      </div>

      <div>
        <strong>Included items</strong>
        <ul class="report-list">
          ${report.reportItems.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </div>

      <div class="report-actions">
        ${downloadButton}
        <a href="#booking" class="button button-secondary">Book another test</a>
      </div>

      <p class="demo-note">${report.canDownload ? (report.hasPdf ? "A PDF report has been attached and is ready to download." : "This report is ready to download from the backend.") : "The report is visible for status tracking. Download can be enabled after final report generation."}</p>
    `;
  } catch (error) {
    reportResult.innerHTML = `
      <p class="report-placeholder">
        No report was found for <strong>${reportId}</strong>. Please check the report ID and try one of the demo IDs shown on the left.
      </p>
    `;
  }
}

function normalizePhone(phoneNumber) {
  const digits = String(phoneNumber || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}
