const demoOutput = document.getElementById('demoOutput');
const demoButtons = document.querySelectorAll('.demo-btn');

const flows = {
  food: {
    voice_input: 'Order chicken biryani for tonight at 8 PM using Zomato under ₹500',
    intent: 'order_food',
    entities: {
      platform: 'zomato',
      item: 'chicken biryani',
      delivery_time: '20:00',
      budget_inr: 500,
      location: 'current_location'
    },
    function_call: {
      name: 'create_food_order',
      provider: 'zomato_api',
      arguments: {
        query: 'chicken biryani',
        delivery_time: '20:00',
        max_price: 500,
        sort_by: ['rating', 'delivery_time']
      }
    },
    confirmation: 'Top match: Biryani Hub | ETA: 32 min | Total: ₹428. Proceed?'
  },
  cab: {
    voice_input: 'Book a cab to airport tomorrow at 7 AM. Compare Ola and Uber.',
    intent: 'book_cab',
    entities: {
      pickup: 'current_location',
      destination: 'airport',
      date: 'tomorrow',
      time: '07:00'
    },
    function_call: {
      name: 'create_cab_booking',
      providers: ['ola_api', 'uber_api'],
      arguments: {
        pickup: 'current_location',
        destination: 'airport',
        time: '07:00',
        compare: ['eta', 'price', 'service_type']
      }
    },
    confirmation: 'Best option: Uber Premier | ETA: 4 min | Fare: ₹612. Confirm booking?'
  }
};

demoButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const flow = flows[button.dataset.flow];
    demoOutput.textContent = JSON.stringify(flow, null, 2);
  });
});
