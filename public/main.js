/* eslint-disable-next-line */
/* global Vue */

document.addEventListener('DOMContentLoaded', () => {
  const app = new Vue({
    el: '#app',
    data: {
      desc: '',
      activeTimers: [],
      oldTimers: []
    },
    methods: {
      createTimer() {
        if (this.desc.trim() === '') {
          alert('Please enter a description.');
          return;
        }

        const newTimer = {
          description: this.desc.trim(),
        };

        fetch('/timer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${window.AUTH_TOKEN}`
          },
          body: JSON.stringify(newTimer)
        })
        .then(response => {
          if (response.ok) {
            return response.json();
          } else {
            throw new Error('Ошибка при создании таймера');
          }
        })
        .then(data => {
          this.activeTimers.push(data.timer);
          console.log('Новый таймер создан:', data);
        })
        .catch(error => {
          console.error('Ошибка при создании таймера:', error);
        });

        this.desc = '';
      },

      stopTimer(timerId) {
        console.log('Timer ID:', timerId);
        if (!timerId) {
          console.error('Ошибка: timerId не определен');
          return;
        }

        fetch(`/timer/stop/${timerId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${window.AUTH_TOKEN}`
          }
        })
        .then(response => {
          if (response.ok) {
            return response.json();
          } else {
            throw new Error('Ошибка при остановке таймера');
          }
        })
        .then(data => {
          const index = this.activeTimers.findIndex(t => t._id === timerId);
          if (index !== -1) {
            const stoppedTimer = this.activeTimers.splice(index, 1)[0];
            stoppedTimer.end = data.timer.end;
            this.oldTimers.push(stoppedTimer);
          }
          console.log('Таймер остановлен:', data);
        })
        .catch(error => {
          console.error('Ошибка при остановке таймера:', error);
        });
      },

      formatDuration(ms) {
        if (isNaN(ms)) {
          return '00:00:00';
        }
        const seconds = Math.floor(ms / 1000);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
      },

      formatOldDuration(start, end) {
        if (!start || !end) {
          return '00:00:00';
        }
        const durationInSeconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
        const hours = Math.floor(durationInSeconds / 3600);
        const minutes = Math.floor((durationInSeconds % 3600) / 60);
        const remainingSeconds = Math.floor(durationInSeconds % 60);
        return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
      },

      formatTime(timestamp) {
        if (!timestamp) {
          return '';
        }
        return new Date(timestamp).toLocaleString('ru-RU', { hour12: false });
      },
    }
  });

  fetch('/timer/update', {
    headers: {
      'Authorization': `Bearer ${window.AUTH_TOKEN}`
    }
  })
  .then(response => {
    if (response.ok) {
      return response.json();
    } else {
      throw new Error('Ошибка при получении таймеров');
    }
  })
  .then(data => {
    app.activeTimers = data.timers.filter(timer => timer.isActive);
    app.oldTimers = data.timers.filter(timer => !timer.isActive);
  })
  .catch(error => {
    console.error('Ошибка при получении таймеров:', error);
  });
});


