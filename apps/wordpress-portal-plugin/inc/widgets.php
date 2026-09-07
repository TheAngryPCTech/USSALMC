<?php
/**
 * USSALMC Portal — Elementor widgets.
 *
 * Three real widgets registered with Elementor: Market, Stat Readout, Module
 * Grid. Each renders via the shared render functions (inc/render.php) which emit
 * the theme's design-system markup, so the ACTIVE theme + the Elementor Global
 * Kit palette style them with no widget-side colors. Controls use Global Colors
 * (`{{WIDGET}}` inherits from the Kit) — requirement #1: no plugin-side palette.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'elementor/widgets/register',
	function ( $widgets_manager ) {

		if ( ! class_exists( '\\Elementor\\Widget_Base' ) ) {
			return;
		}

		/** Base class: shared category + Global-Color note. */
		abstract class USSALMC_Portal_Widget_Base extends \Elementor\Widget_Base {
			public function get_categories() {
				return array( 'ussalmc' );
			}
			public function get_custom_help_url() {
				return 'https://ussa.space';
			}
			// A minimal content control so the widget has a settings panel; the
			// palette itself comes from the theme + Elementor Global Kit, not here.
			protected function register_controls() {
				$this->start_controls_section(
					'section_content',
					array( 'label' => 'USSALMC', 'tab' => \Elementor\Controls_Manager::TAB_CONTENT )
				);
				$this->add_control(
					'title',
					array(
						'label'   => 'Panel title',
						'type'    => \Elementor\Controls_Manager::TEXT,
						'default' => $this->default_title(),
					)
				);
				$this->add_control(
					'palette_note',
					array(
						'type'            => \Elementor\Controls_Manager::RAW_HTML,
						'raw'             => 'Colors & fonts inherit from the USSALMC Global Kit + active theme automatically.',
						'content_classes' => 'elementor-descriptor',
					)
				);
				$this->extra_controls();
				$this->end_controls_section();
			}
			protected function extra_controls() {}
			abstract protected function default_title();
		}

		/** 1) Commodity Market */
		class USSALMC_Widget_Market extends USSALMC_Portal_Widget_Base {
			public function get_name() { return 'ussalmc-market'; }
			public function get_title() { return 'USSALMC Market'; }
			public function get_icon() { return 'eicon-price-list'; }
			public function get_keywords() { return array( 'ussalmc', 'market', 'trade', 'commodity' ); }
			protected function default_title() { return 'Commodity Market'; }
			protected function render() {
				$s = $this->get_settings_for_display();
				echo ussalmc_portal_render_market( array( 'title' => $s['title'] ?? 'Commodity Market' ) );
			}
		}

		/** 2) Stat Readout */
		class USSALMC_Widget_Stat_Readout extends USSALMC_Portal_Widget_Base {
			public function get_name() { return 'ussalmc-stat-readout'; }
			public function get_title() { return 'USSALMC Stat Readout'; }
			public function get_icon() { return 'eicon-counter'; }
			public function get_keywords() { return array( 'ussalmc', 'stats', 'readout', 'hud' ); }
			protected function default_title() { return 'Instrument Readout'; }
			protected function render() {
				echo ussalmc_portal_render_stat_readout();
			}
		}

		/** 3) Module Grid */
		class USSALMC_Widget_Module_Grid extends USSALMC_Portal_Widget_Base {
			public function get_name() { return 'ussalmc-module-grid'; }
			public function get_title() { return 'USSALMC Module Grid'; }
			public function get_icon() { return 'eicon-gallery-grid'; }
			public function get_keywords() { return array( 'ussalmc', 'entities', 'knowledge', 'grid' ); }
			protected function default_title() { return 'Knowledge Base — Recent Entities'; }
			protected function extra_controls() {
				$this->add_control(
					'limit',
					array(
						'label'   => 'Entities to show',
						'type'    => \Elementor\Controls_Manager::NUMBER,
						'default' => 6,
						'min'     => 1,
						'max'     => 20,
					)
				);
			}
			protected function render() {
				$s = $this->get_settings_for_display();
				echo ussalmc_portal_render_module_grid(
					array( 'title' => $s['title'] ?? '', 'limit' => (int) ( $s['limit'] ?? 6 ) )
				);
			}
		}

		$widgets_manager->register( new USSALMC_Widget_Market() );
		$widgets_manager->register( new USSALMC_Widget_Stat_Readout() );
		$widgets_manager->register( new USSALMC_Widget_Module_Grid() );
	}
);

/** Register an "USSALMC" widget category so the three widgets group together. */
add_action(
	'elementor/elements/categories_registered',
	function ( $elements_manager ) {
		$elements_manager->add_category(
			'ussalmc',
			array( 'title' => 'USSALMC', 'icon' => 'fa fa-plug' )
		);
	}
);
