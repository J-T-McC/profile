<template>
  <form class="w-full max-w-lg" name="contact" @submit.prevent="handleSubmit">
    <div class="flex flex-wrap ">
      <div class="w-full">
        <label class="sr-only" for="email">
          E-mail
        </label>
        <input
            v-model="form.email"
            class="
                appearance-none
                block
                w-full
                text-gray-700 dark:text-gray-300
                dark:bg-gray-900
                border
                border-gray-200 dark:border-black
                rounded
                py-3
                px-4
                mb-3
                leading-tight
                focus:outline-none
                focus:bg-white
                focus:border-gray-500
            "
            placeholder="E-Mail Address"
            id="email"
            type="email"
            required>
      </div>
    </div>
    <div class="flex flex-wrap">
      <div class="w-full">
        <label class="sr-only" for="message">Message</label>
        <textarea
            v-model="form.message"
            class="
               block
               w-full
               h-24
               xl:h-48
               text-gray-700 dark:text-gray-300
               dark:bg-gray-900
               border
               rounded
               border-gray-200 dark:border-black
               py-3
               px-4
               focus:outline-none
               focus:bg-white
               focus:border-gray-500"
            placeholder="Message..."
            id="message"
            required>
        </textarea>
      </div>
    </div>
    <div class="md:flex md:items-center">
      <div class="md:w-1/3">
        <button
            class="
               font-medium
               rounded-md
               text-blue-700 dark:text-gray-200
               bg-indigo-100 dark:bg-blue-700
               hover:text-indigo-600
               hover:bg-indigo-200
               focus:outline-none
               transition duration-150
               ease-in-out
               py-2
               px-4
               mt-3"
            type="submit">Send
        </button>
      </div>
      <div class="md:w-2/3"></div>
    </div>
  </form>

</template>

<script>

import axios from "axios";
import {useToast, POSITION} from "vue-toastification";
import {ref} from 'vue'

export default {
  name: "ContactForm",
  setup() {

    const toast = useToast()
    const toastMessage = (type, text) => {
      toast[type](text, {
        timeout: 2000,
        position: POSITION.BOTTOM_RIGHT,
        toastClassName: "custom-toast-class",
        pauseOnFocusLoss: false
      });
    }

    const defaultForm = {
      email: null,
      message: null,
      "form-name": "contact",
    }
    const form = ref({ ...defaultForm })
    const resetForm = () => {
      form.value = { ...defaultForm }
    }

    return {
      toast,
      toastMessage,
      form,
      resetForm
    }
  },
  methods: {
    createFormDataObj(data) {
      const formData = new FormData();
      for (const key of Object.keys(data)) {
        formData.append(key, data[key]);
      }
      return formData;
    },
    handleSubmit() {
      axios.post("/", new URLSearchParams(
          this.createFormDataObj(this.form)
      ).toString(), {
        header: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }).then(response => {
        if (response.status === 200) {
          this.resetForm();
          this.toastMessage('success', 'E-mail Sent!');
        } else {
          throw new Error(response.statusText)
        }
      }).catch(() =>   this.toastMessage('error', 'Failed to sent E-mail'));
    }
  }
}

</script>

<style>

</style>