/**
 * ADA Architecture - Global Theme Engine
 * Persistent Light/Dark Mode Coordinator
 */

// 1. IMMEDIATE EXECUTION: Runs instantly before the DOM paints to block the "white layout flash"
(function () {
    const savedTheme = localStorage.getItem('ada_global_theme') || 'light';
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark-theme');
    } else {
        document.documentElement.classList.remove('dark-theme');
    }
})();

// 2. INTERACTIVE SWITCHER: Bound to your navigation bar button click actions
function toggleGlobalTheme() {
    const htmlEl = document.documentElement;
    const togglerTexts = document.querySelectorAll('.theme-toggle-text');
    
    htmlEl.classList.toggle('dark-theme');
    
    if (htmlEl.classList.contains('dark-theme')) {
        localStorage.setItem('ada_global_theme', 'dark');
        updateTogglerButtonText(togglerTexts, "Light View");
    } else {
        localStorage.setItem('ada_global_theme', 'light');
        updateTogglerButtonText(togglerTexts, "Dark View");
    }
}

// Helper routine to change button copy text uniformly across layout elements
function updateTogglerButtonText(elements, textString) {
    if (elements && elements.length) {
        elements.forEach(el => {
            el.innerText = textString;
        });
    }
}

// 3. HYDRATOR: Syncs UI layout components cleanly when the DOM tree finishes mounting
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('ada_global_theme') || 'light';
    const togglerTexts = document.querySelectorAll('.theme-toggle-text');
    
    if (savedTheme === 'dark') {
        updateTogglerButtonText(togglerTexts, "Light View");
    } else {
        updateTogglerButtonText(togglerTexts, "Dark View");
    }
});
