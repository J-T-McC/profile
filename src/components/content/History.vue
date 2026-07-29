<template>
  <section-break
      gradient-from="from-purple-400"
      gradient-via="via-pink-400"
      gradient-to="to-blue-500"
      animation="animate-gradient-xy">
  </section-break>
  <!-- The arcade game lives in its own component and renders this job-history content as
       its overlaid "world". #about (the scroll anchor + fullscreen target) lives inside it. -->
  <space-game>
    <div class="lg:bg-gradient-to-r from-white via-white to-gray-200 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 pt-6 lg:pt-0 dark:bg-gray-900 z-50 pb-5 lg:pb-0 transition-colors duration-500">
      <card-row
          v-for="(card, i) in cards"
          v-bind:key="card"
          :card="card"
          :reverse="i % 2 === 0"
          :delay="i">
      </card-row>
    </div>
  </space-game>
  <section-break
      gradient-from="from-purple-500 dark:from-blue-900"
      gradient-via="via-pink-200"
      gradient-to="to-blue-500"
      animation="animate-gradient-xy">
  </section-break>
</template>

<script>

import CardRow from '@/components/reusable/CardRow'
import SectionBreak from '@/components/reusable/SectionBreak'
import SpaceGame from '@/components/content/SpaceGame'

export default {
  name: 'History',
  components: {
    CardRow,
    SectionBreak,
    SpaceGame
  },
  setup () {
    return {
      cards: [
        {
          header: 'Atmosphere TV - Staff Software Engineer',
          date: 'June 2022-Current',
          body: `(☞ຈل͜ຈ)☞ Role & Title Bump.`,
        },
        {
          header: 'Atmosphere TV - Senior Developer',
          date: 'January 2022-June 2022',
          body: `An opportunity arose to join an amazing group of people at Atmosphere TV. Atmosphere TV is headquartered in Austin Texas but has offices around the world.`,
          callToAction: {
            label: 'Check them out!',
            url: 'https://www.atmosphere.tv/'
          }
        },
        {
          header: 'RocketPlan - Senior Backend Developer',
          date: 'April 2021-December 2021',
          body: `Got the opportunity to join a great team at RocketPlan Technologies as a Senior Backend Developer.`,
          callToAction: {
            label: 'More about RocketPlan',
            url: 'https://rocketplantech.com/'
          }
        },
        {
          header: 'Open to New Opportunities',
          date: 'January 2021-March 2021',
          body: `Made the difficult decision to part ways with Sentis. As much as I love the team and culture,
          I felt this was a necessary step to focus my career on development and to put away some of the roles I have been performing.
          Taking some time to learn and create a public github presence, hopefully contributing to the open source community in the process.`,
          callToAction: {
            label: 'View recent activity on GitHub!',
            url: 'https://github.com/J-T-McC'
          }
        },
        {
          header: 'Sentis - Head of Systems & Solutions',
          date: 'April 2018-January 2021',
          body: `Promoted to Head of Systems & Solutions and charged with overseeing the Development team and IT footprint.
          Completion of migration to AWS and company to AzureAD & O365.
          Improving upon & implementation of policies and procedures, automating repetitive company process and reduction
          of technical debt. Laravel and VueJS focused.`,
        },
        {
          header: 'Sentis - Developer',
          date: 'April 2015-2018',
          body: `Pivoting away from the survey platform and into custom client portals. Throughout this period I was
          introduced to my first frameworks & web servers. Working on a small team sometimes means wearing many hats.
          Taking on additional responsibilities to help spread the load. Introduced to Active Directory, Exchange and
          Asterisk. Personal focus remains on development.`
        },
        {
          header: 'Sentis - Survey Programmer',
          date: 'April 2013-2016',
          body: `Tasked with developing our ever evolving survey themes and question designs. Primarily a front-end roll
          focusing on product visuals, user experience and browser compatibility.
          Introduced to (┛ಠ_ಠ)┛彡Internet Explorer 8 ┻━┻.`
        },
        {
          header: 'Sentis - Call Centre Manager',
          date: 'April 2012-2014',
          body: `Overseeing the call centre operations.`
        }
      ]
    }
  },

}
</script>
