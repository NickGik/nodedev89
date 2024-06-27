/* eslint-disable-next-line */
/* global Vue */

document.addEventListener('DOMContentLoaded', () => {
  new Vue({
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
            throw new Error('Error creating timer');
          }
        })
        .then(data => {
          this.activeTimers.push(data.timer);
          console.log('New timer created:', data);
        })
        .catch(error => {
          console.error('Error creating timer:', error);
        });

        this.desc = '';
      },

      stopTimer(timerId) {
        console.log('Timer ID:', timerId);
        if (!timerId) {
          console.error('Error: timerId is not defined');
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
            throw new Error('Error stopping timer');
          }
        })
        .then(data => {
          const index = this.activeTimers.findIndex(t => t._id === timerId);
          if (index !== -1) {
            const stoppedTimer = this.activeTimers.splice(index, 1)[0];
            stoppedTimer.end = data.timer.end;
            this.oldTimers.push(stoppedTimer);
          }
          console.log('Timer stopped:', data);
        })
        .catch(error => {
          console.error('Error stopping timer:', error);
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

      updateTimersUI(timers) {
        const currentTime = new Date().getTime();
        this.activeTimers = timers.filter(timer => timer.isActive).map(timer => {
          timer.elapsedTime = currentTime - new Date(timer.start).getTime();
          return timer;
        });
        this.oldTimers = timers.filter(timer => !timer.isActive);
      }
    },
    created() {
      // Подключение к WebSocket
      const ws = new WebSocket('ws://localhost:3000');

      ws.onmessage = (event) => {
        const timers = JSON.parse(event.data);
        this.updateTimersUI(timers); 
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
      };

      // Инициализация таймеров при загрузке
      fetch('/timer/update', {
        headers: {
          'Authorization': `Bearer ${window.AUTH_TOKEN}`
        }
      })
      .then(response => {
        if (response.ok) {
          return response.json();
        } else {
          throw new Error('Error fetching timers');
        }
      })
      .then(data => {
        this.updateTimersUI(data.timers);
      })
      .catch(error => {
        console.error('Error fetching timers:', error);
      });
    }
  });
});
